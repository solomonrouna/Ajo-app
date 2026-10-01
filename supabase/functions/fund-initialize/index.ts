import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

const ALLOWED_ORIGINS = [
  "https://ajo-app-zeta.vercel.app",
  "http://localhost:5173",
];

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin)
      ? origin
      : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}


Deno.serve(async (req) => {
    console.log("request received:", req.method);
  // Browsers ask "am I allowed to call you?" before the real request.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return reply(req, { error: "Method not allowed" }, 405);
  }

  // Find out who is calling, from their login token.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
  });
  const { data: userData } = await userClient.auth.getUser();
  const user = userData?.user;
  if (!user || !user.email) {
    return reply(req, { error: "Please log in again." }, 401);
  }

    // Read the amount the user wants to fund (in naira).
  const body = await req.json().catch(() => ({}));
  const amountNaira = Number(body?.amount);

  const MIN_NAIRA = 100;
  const MAX_NAIRA = 200000;
  if (
    !Number.isInteger(amountNaira) ||
    amountNaira < MIN_NAIRA ||
    amountNaira > MAX_NAIRA
  ) {
    return reply(
      req,
      { error: `Enter a whole amount between ₦${MIN_NAIRA} and ₦${MAX_NAIRA}.` },
      400,
    );
  }

  // Paystack works in kobo (₦1 = 100 kobo).
  const amountKobo = amountNaira * 100;

  // Make a unique reference for this payment attempt.
  const reference = `ajo_${crypto.randomUUID()}`;

  // Save the attempt as "pending" BEFORE talking to Paystack.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error: saveError } = await admin.from("paystack_payments").insert({
    reference,
    user_id: user.id,
    amount_kobo: amountKobo,
    status: "pending",
  });
  if (saveError) {
    console.log("could not save payment", saveError.message);
    return reply(req, { error: "Could not start payment. Try again." }, 500);
  }

  // Ask paystack to start a checkout.
  let authorizationUrl: string | null = null;
  try {
    const psResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: user.email,
          amount: amountKobo,
          currency: "NGN",
          reference,
          callback_url: ALLOWED_ORIGINS[0],
        }),
      },
    );
    const psData = await psResponse.json();
    if (psResponse.ok && psData?.status) {
      authorizationUrl = psData.data?.authorization_url ?? null;
    } else {
      console.log("paystack refused", psData?.message);
    }
  } catch (err) {
    console.log("could not reach paystack", String(err));
  }

  // If Paystack didn't give us a link, mark the attempt as failed.
  if (!authorizationUrl) {
    await admin
      .from("paystack_payments")
      .update({ status: "failed" })
      .eq("reference", reference);
    return reply(req, { error: "Could not start payment. Try again." }, 502);
  }

  // Success: send the checkout link back to the app.
  return reply(req, { authorization_url: authorizationUrl, reference });

});