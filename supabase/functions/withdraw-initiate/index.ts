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
  console.log("withdraw-initiate request:", req.method);

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
  if (!user) {
    return reply(req, { error: "Please log in again." }, 401);
  }

  // Read what they asked for.
  const body = await req.json().catch(() => ({}));
  const amount = Number(body?.amount);
  const pin = String(body?.pin ?? "");

  // Quick checks first. (The database enforces the real limits later.)
  if (!Number.isInteger(amount) || amount <= 0) {
    return reply(req, { error: "Enter a whole amount in naira." }, 400);
  }
  if (!/^[0-9]{4,6}$/.test(pin)) {
    return reply(req, { error: "Enter your PIN." }, 400);
  }

  // The PIN must be right BEFORE any money move.
  const { data: hasPin } = await userClient.rpc("has_pin");
  if (hasPin !== true) {
    return reply(req, { error: "Set a withdrawal PIN first." }, 403);
  }
  const { data: pinOk, error: pinError } = await userClient.rpc("verify_pin", {
    p_user_id: user.id,
    p_pin: pin,
  });
  if (pinError) {
    const locked = pinError.message.includes("Too many");
    return reply(
      req,
      { error: locked ? pinError.message : "Could not check your PIN." },
      locked ? 429 : 500,
    );
  }
  if (pinOk !== true) {
    return reply(req, { error: "Incorrect PIN." }, 403);
  }

    // Reserve the money: the database checks the limits, works out the fees
  // and takes the amount out of the wallet in one all-or-nothing step.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: reserved, error: reserveError } = await admin.rpc(
    "reserve_withdrawal",
    { p_user_id: user.id, p_amount_naira: amount },
  );

  if (reserveError || !reserved) {
    const msg = reserveError?.message ?? "";
    const known = [
      "minimum withdrawal",
      "maximum withdrawal",
      "Add a bank account first",
      "Insufficient balance",
      "Daily withdrawal limit reached",
      "too small after fees",
    ].some((phrase) => msg.includes(phrase));
    if (!known) console.log("reserve failed", msg);
    return reply(
      req,
      { error: known ? msg : "Could not start your withdrawal. Try again." },
      known ? 400 : 500,
    );
  }

  // Ask Paystack to send the money.
  let outcome = "unknown" as "accepted" | "refused" | "unknown";
  let transferCode: string | null = null;
  let refusalReason = "";

  try {
    const res = await fetch("https://api.paystack.co/transfer", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "balance",
        amount: reserved.net_kobo,
        recipient: reserved.recipient_code,
        reference: reserved.reference,
        reason: "ajo wallet withdrawal",
        currency: "NGN",
      }),
    });
    const data = await res.json().catch(() => null);

    if (res.ok && data?.status) {
      outcome = "accepted";
      transferCode = data.data?.transfer_code ?? null;
      if (data.data?.status === "otp") {
        console.log(
          "WARNING: Paystack is asking for an OTP. Turn off transfer confirmation in your Paystack settings.",
          reserved.reference,
        );
      }
    } else if (res.status >= 400 && res.status < 500) {
      outcome = "refused";
      refusalReason = String(data?.message ?? "refused");
    } else {
      console.log("paystack transfer outcome unknown", res.status, reserved.reference);
    }
  } catch (err) {
    console.log("could not reach paystack for transfer", reserved.reference, String(err));
  }

  // Paystack clearly said no: give the money back straight away.
  if (outcome === "refused") {
    console.log("paystack refused transfer", reserved.reference, refusalReason);
    const { error: refundError } = await admin.rpc("refund_withdrawal", {
      p_reference: reserved.reference,
      p_new_status: "failed",
      p_reason: refusalReason,
    });
    if (refundError) {
      console.log("REFUND FAILED - fix by hand", reserved.reference, refundError.message);
      return reply(req, { error: "Something went wrong. Please contact support." }, 500);
    }
    return reply(
      req,
      { error: "The transfer could not be started. Your money is back in your wallet." },
      502,
    );
  }

  if (transferCode) {
    await admin
      .from("withdrawals")
      .update({ transfer_code: transferCode })
      .eq("reference", reserved.reference);
  }

  // Accepted, or we couldn't tell. Either way it stays "pending" until Paystack's
  // message arrives at the webhook and settles it.
  return reply(req, {
    processing: true,
    reference: reserved.reference,
    amount,
    fee: reserved.fee_kobo / 100,
    receive: reserved.net_kobo / 100,
  });
});