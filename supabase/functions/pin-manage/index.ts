import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  console.log("pin-manage request:", req.method);

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

  // Read what they sent. Only the new PIN is required.
  const body = await req.json().catch(() => ({}));
  const newPin = String(body?.new_pin ?? "");
  const currentPin = String(body?.current_pin ?? "");
  const password = String(body?.password ?? "");

  if (!/^[0-9]{4,6}$/.test(newPin)) {
    return reply(req, { error: "Your PIN must be 4 to 6 digits." }, 400);
  }

    // Do they already have a PIN?
  const { data: hasPin } = await userClient.rpc("has_pin");

  // Proof of identity, checked by the server and never by the screen.
  if (hasPin === true && currentPin) {
    // Changing a PIN: the current PIN must be right (this keeps the 5-tries lockout).
    const { data: pinOk, error: pinError } = await userClient.rpc("verify_pin", {
      p_user_id: user.id,
      p_pin: currentPin,
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
      return reply(req, { error: "Your current PIN is incorrect." }, 403);
    }
  } else {
    // First PIN, or "forgot PIN": the account password must be right.
    if (!password) {
      return reply(req, { error: "Enter your account password to continue." }, 400);
    }
    const checker = createClient(SUPABASE_URL, ANON_KEY);
    const { error: passwordError } = await checker.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (passwordError) {
      return reply(req, { error: "Incorrect password." }, 403);
    }
  }

  // Proof accepted. Set the PIN through the server-only database function.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error: setError } = await admin.rpc("server_set_pin", {
    p_user_id: user.id,
    p_pin: newPin,
  });
  if (setError) {
    console.log("could not set pin", setError.message);
    return reply(req, { error: "Could not save your PIN. Try again." }, 500);
  }

  return reply(req, { ok: true });
});