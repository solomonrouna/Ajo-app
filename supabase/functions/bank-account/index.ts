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

async function paystackGet(path: string) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

Deno.serve(async (req) => {
  console.log("bank-account request:", req.method);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return reply(req, { error: "Method not allowed" }, 405);
  }

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

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "banks") {
    let all: any[] = [];
    let next: string | null = null;

    for (let page = 0; page < 10; page++) {
      const query: string =
        `/bank?currency=NGN&use_cursor=true&perPage=100` +
        (next ? `&next=${encodeURIComponent(next)}` : "");
      const { ok, data } = await paystackGet(query);

      if (!ok || !data?.status) {
        console.log("could not load banks", data?.message);
        return reply(req, { error: "Could not load banks. Try again." }, 502);
      }

      all = all.concat(data.data);
      next = data.meta?.next ?? null;
      if (!next) break;
    }

    const banks = all
      .filter((b) => b.active && !b.is_deleted)
      .map((b) => ({ name: b.name, code: b.code }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return reply(req, { banks });
  }

  if (action === "resolve") {
    const accountNumber = String(body?.account_number ?? "");
    const bankCode = String(body?.bank_code ?? "");

    if (!/^[0-9]{10}$/.test(accountNumber)) {
      return reply(req, { error: "Account number must be 10 digits." }, 400);
    }
    if (!/^[0-9]{2,8}$/.test(bankCode)) {
      return reply(req, { error: "Please choose a bank." }, 400);
    }

    const { ok, data } = await paystackGet(
      `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
    );

    if (!ok || !data?.status || !data.data?.account_name) {
      console.log("could not resolve account", data?.message);
      return reply(
        req,
        { error: "We could not verify that account. Check the number and bank." },
        422,
      );
    }

    return reply(req, { account_name: data.data.account_name });
  }

  if (action === "save") {
    const accountNumber = String(body?.account_number ?? "");
    const bankCode = String(body?.bank_code ?? "");
    const pin = String(body?.pin ?? "");

    if (!/^[0-9]{10}$/.test(accountNumber)) {
      return reply(req, { error: "Account number must be 10 digits." }, 400);
    }
    if (!/^[0-9]{2,8}$/.test(bankCode)) {
      return reply(req, { error: "Please choose a bank." }, 400);
    }

    // A recent PIN change pauses bank-account changes for 24 hours.
    const admin0 = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: cooldownRow } = await admin0
      .from("profiles")
      .select("pin_changed_at")
      .eq("id", user.id)
      .maybeSingle();
    const changedAt = cooldownRow?.pin_changed_at ? new Date(cooldownRow.pin_changed_at) : null;
    if (changedAt && Date.now() - changedAt.getTime() < 24 * 60 * 60 * 1000) {
      return reply(
        req,
        { error: "Your PIN was changed recently. For your security, bank account changes are paused for 24 hours." },
        403,
      );
    }

    // Saving a bank account needs the withdrawal PIN.
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

    console.log("could not resolve account (save)");
    const { ok, data } = await paystackGet(
      `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
    );
    const accountName: string | undefined = data?.data?.account_name;
    if (!ok || !data?.status || !accountName) {
      return reply(
        req,
        { error: "We could not verify that account. Check the number and bank." },
        422,
      );
    }

    const rRes = await fetch("https://api.paystack.co/transferrecipient", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "nuban",
        name: accountName,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: "NGN",
      }),
    });
    const rData = await rRes.json().catch(() => null);
    const recipientCode: string | undefined = rData?.data?.recipient_code;
    if (!rRes.ok || !rData?.status || !recipientCode) {
      console.log("could not create recipient", rData?.message);
      return reply(req, { error: "Could not save that account. Try again." }, 502);
    }

    const bankName: string = rData.data?.details?.bank_name ?? "Bank";
    const last4 = accountNumber.slice(-4);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: saveError } = await admin.from("bank_accounts").upsert(
      {
        user_id: user.id,
        bank_code: bankCode,
        bank_name: bankName,
        account_name: accountName,
        account_last4: last4,
        recipient_code: recipientCode,
      },
      { onConflict: "user_id" },
    );
    if (saveError) {
      console.log("could not save bank account", saveError.message);
      return reply(req, { error: "Could not save that account. Try again." }, 500);
    }

    return reply(req, {
      bank_name: bankName,
      account_name: accountName,
      account_last4: last4,
    });
  }

  if (action === "mine") {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data, error } = await admin
      .from("bank_accounts")
      .select("bank_name, account_name, account_last4")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.log("could not load bank account", error.message);
      return reply(req, { error: "Could not load your bank account." }, 500);
    }

    return reply(req, { account: data });
  }

  return reply(req, { error: "Unknown action" }, 400);
});