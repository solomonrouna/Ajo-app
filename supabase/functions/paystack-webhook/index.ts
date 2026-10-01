import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;

// Checks that a message really came from Paystack.
async function isValidSignature(rawBody: string, signature: string | null) {
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Compare every character, without stopping early at the first difference.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  console.log("webhook received:", req.method);
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Read the RAW text first. The fingerprint is made from it exactly as sent.
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!(await isValidSignature(rawBody, signature))) {
    console.log("rejected: bad signature");
    return new Response("Invalid signature", { status: 401 });
  }

  // Only now is it safe to read the message.
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Money-out results from Paystack Transfers (withdrawals).
  const eventName: string = event?.event ?? "";
  if (
    eventName === "transfer.success" ||
    eventName === "transfer.failed" ||
    eventName === "transfer.reversed"
  ) {
    const ref = event?.data?.reference;
    if (typeof ref !== "string") {
      return new Response("no reference", { status: 200 });
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (eventName === "transfer.success") {
      const { data: w } = await db
        .from("withdrawals")
        .select("net_kobo")
        .eq("reference", ref)
        .maybeSingle();

      if (!w) {
        console.log("transfer result for unknown withdrawal", ref);
        return new Response("unknown reference", { status: 200 });
      }
      if (Number(event?.data?.amount) !== Number(w.net_kobo)) {
        console.log("TRANSFER MISMATCH - check by hand", ref, event?.data?.amount, w.net_kobo);
        return new Response("mismatch", { status: 200 });
      }

      const { data: done, error: doneError } = await db.rpc("complete_withdrawal", {
        p_reference: ref,
        p_transfer_code: event?.data?.transfer_code ?? null,
      });
      if (doneError) {
        console.log("could not complete withdrawal", ref, doneError.message);
        return new Response("complete failed", { status: 500 });
      }
      console.log("withdrawal result", ref, done);
      return new Response("ok", { status: 200 });
    }

    // Failed or reversed: put the money back in the wallet (only ever once).
    const { data: back, error: backError } = await db.rpc("refund_withdrawal", {
      p_reference: ref,
      p_new_status: eventName === "transfer.reversed" ? "reversed" : "failed",
      p_reason: eventName,
    });
    if (backError) {
      console.log("REFUND FAILED - fix by hand", ref, backError.message);
      return new Response("refund failed", { status: 500 });
    }
    console.log("withdrawal refund result", ref, back);
    return new Response("ok", { status: 200 });
  }

  // We only act on successful charges. Say "ok" to everything else.
  if (event?.event !== "charge.success") {
    return new Response("ignored", { status: 200 });
  }

  const reference = event?.data?.reference;
  if (typeof reference !== "string") {
    return new Response("no reference", { status: 200 });
  }

  // Don't trust the message alone. Ask Paystack directly.
  let verified: any = null;
  try {
    const vRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } },
    );
    verified = await vRes.json();
  } catch (err) {
    console.log("could not reach paystack to verify", String(err));
    return new Response("verify failed", { status: 500 });
  }

  const tx = verified?.data;
  if (!verified?.status || tx?.status !== "success") {
    console.log("paystack says not successful", reference);
    return new Response("not successful", { status: 200 });
  }

  // Compare with what WE saved before the payment started.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: payment } = await admin
    .from("paystack_payments")
    .select("user_id, amount_kobo")
    .eq("reference", reference)
    .maybeSingle();

  if (!payment) {
    console.log("unknown reference", reference);
    return new Response("unknown reference", { status: 200 });
  }
  
    const expected = Number(payment.amount_kobo);
  const total = Number(tx.amount);
  const fees = Number(tx.fees ?? 0);
  const feesLookSane = Number.isFinite(fees) && fees >= 0 && fees <= 200000;
  const amountOk =
    total === expected || // the fee comes out of our side
    (feesLookSane && total - fees === expected); // the customer paid the fee on top

  if (!amountOk || tx.currency !== "NGN") {
    console.log("MISMATCH", reference, total, fees, expected, tx.currency);
    return new Response("mismatch", { status: 200 });
  }

  // Credit the wallet. The database function does check-and-credit as ONE action.
  const { data: result, error: creditError } = await admin.rpc(
    "credit_paystack_payment",
    { p_reference: reference },
  );

  if (creditError) {
    console.log("credit failed", reference, creditError.message);
    return new Response("credit failed", { status: 500 });
  }

  console.log("credit result", reference, result);
  return new Response("ok", { status: 200 });
});