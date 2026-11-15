// Robin cold-run friction (2026-11-14, MCP Cold-User lane, persona
// "Robin"): R1 the unbound recap misstated the user's state (it
// asserted no artwork attached and no email captured for a user who
// had done both, because neither the intent text nor the questions
// named the binding arguments get_recap needs); R2 the recap's
// WELCOME10 window named the quote date itself as the end of the
// 7-day window; R3 the placement confirmation headlined the quote's
// list total while its own invoice carried the discounted total.
// Each test here fails on the pre-fix code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runTool } from "../src/tools.ts";
import type { Env } from "../src/env.ts";

class MemoryKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.store.get(key) ?? null;
    if (raw === null) return null;
    if (type === "json") return JSON.parse(raw);
    if (type === "arrayBuffer") {
      const bin = atob(raw);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8.buffer;
    }
    return raw;
  }
  async put(key: string, value: unknown): Promise<void> {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const u8 = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      let bin = "";
      for (const b of u8) bin += String.fromCharCode(b);
      this.store.set(key, btoa(bin));
    } else {
      this.store.set(key, String(value));
    }
  }
  async delete(key: string): Promise<void> { this.store.delete(key); }
  async list(opts?: { prefix?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean }> {
    const keys = [...this.store.keys()].filter((k) => !opts?.prefix || k.startsWith(opts.prefix));
    return { keys: keys.map((name) => ({ name })), list_complete: true };
  }
}

function makeEnv(): Env {
  return {
    MCP_KEYS: new MemoryKV() as unknown as KVNamespace,
    MCP_ARTWORK: new MemoryKV() as unknown as KVNamespace,
    ORDERS: new MemoryKV() as unknown as KVNamespace,
    DEV_ORDERS: new MemoryKV() as unknown as KVNamespace,
    STRIPE_API_KEY_TEST: "sk_test_stub",
    MCP_INVOKE_SECRET: "test-secret",
  } as unknown as Env;
}

function req(): Request {
  return new Request("https://tap.giving/mcp", { method: "POST", headers: {} });
}

// The business doors and Stripe stubbed at the fetch seam, as in the
// post-placement suite: the mint returns the first-order total when
// the placement is discount-eligible, so an order's invoice total
// (45000) differs from its quote's list total (50000) by design.
function stubFetch() {
  return async (input: unknown, init?: { method?: string; body?: string }): Promise<Response> => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes("/api/lead")) return new Response(JSON.stringify({ queued: true }), { status: 200 });
    if (url.includes("/api/invoice-request")) return new Response(JSON.stringify({ ok: true, totalUsd: "900.00" }), { status: 200 });
    if (url.includes("/api/mcp-invoke")) {
      const parsed = JSON.parse(init?.body || "{}");
      if (parsed.op === "recordArtworkSubmission") return new Response(JSON.stringify({ ok: true, recordKey: "STEPCAP:1:x" }), { status: 200 });
      if (parsed.op === "notifyOrderPlaced") return new Response(JSON.stringify({ ok: true, messageId: "msg_stub_order_email" }), { status: 200 });
      if (parsed.op === "mintOrderInvoice") {
        const t = (parsed.input?.totals ?? {}) as Record<string, unknown>;
        const totalCents = t.discountEligible === true ? t.firstOrderTotalCents : t.grandTotalCents;
        return new Response(JSON.stringify({ ok: true, invoice: { id: "in_stub", number: "TEST-0001", status: "open", hostedInvoiceUrl: "https://invoice.stripe.com/i/stub", invoicePdf: "https://stripe.example/in_stub.pdf", totalCents, finalizedAt: "2026-11-14T12:00:00.000Z" } }), { status: 200 });
      }
      if (parsed.op === "sendOrderInvoiceProof") return new Response(JSON.stringify({ ok: true, messageId: "msg_stub_customer_email" }), { status: 200 });
      if (parsed.op === "readOrderRecords") return new Response(JSON.stringify({ ok: true, found: false, crmRow: null, fulfillment: null }), { status: 200 });
      return new Response(JSON.stringify({ ok: false }), { status: 400 });
    }
    if (url.includes("api.stripe.com")) {
      if (url.includes("/customers") && (!init || init.method === "GET" || !init.method)) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes("/customers")) return new Response(JSON.stringify({ id: "cus_stub" }), { status: 200 });
      if (url.includes("/invoices") && init?.method !== "POST") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes("/invoices") && init?.method === "POST" && !url.includes("finalize")) {
        return new Response(JSON.stringify({ id: "in_stub" }), { status: 200 });
      }
      if (url.includes("/invoiceitems")) return new Response(JSON.stringify({ id: "ii_stub" }), { status: 200 });
      if (url.includes("finalize")) {
        return new Response(JSON.stringify({ id: "in_stub", number: "TEST-0001", status: "open", hosted_invoice_url: "https://invoice.stripe.com/i/stub", total: 45000 }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }
    return new Response("nope", { status: 404 });
  };
}

const SHIP_TO = {
  name: "Robin Ellis", street: "400 Harbor Way", city: "Spring", state: "TX",
  postalCode: "77380", country: "US", phone: "+17135550199",
};
const ROBIN_EMAIL = "robin-fix@mcptest.org";
const ROBIN_ORG = "TEST Harborview Community Church (robin fix run - DO NOT CONTACT)";

const SVG_BYTES = new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2120" height="2120"><rect width="2120" height="2120" fill="#123456"/></svg>'));
async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

test("R1: an unbound recap asserts nothing the server cannot know", async () => {
  const env = makeEnv();
  const fetchFn = stubFetch() as unknown as typeof fetch;
  // Robin's state: artwork submitted AND email captured, then a recap
  // called with only its four required fields.
  const sub = await runTool(env, req(), "submit_artwork", {
    file: { filename: "disc.svg", mediaType: "image/svg+xml", contentBase64: Buffer.from(SVG_BYTES).toString("base64") },
    sha256: await sha256HexBytes(SVG_BYTES), shape: "round",
  }, fetchFn);
  assert.ok(sub.structured.artworkRef, "artwork submitted");
  await runTool(env, req(), "start_order_intent", { email: ROBIN_EMAIL, organizationName: ROBIN_ORG }, fetchFn);
  const r = await runTool(env, req(), "get_recap", {
    quantity: 100, size: "100mm-round", mounting: "adhesive", shipTo: SHIP_TO,
  }, fetchFn);
  // The recap was not GIVEN the email or the artwork reference; it may
  // say so, but it must not claim neither exists.
  assert.ok(!r.text.includes("Artwork: none attached"), "the recap does not assert no artwork is attached");
  assert.ok(!r.text.includes("no contact email has been captured"), "the recap does not assert no email was captured");
  assert.ok(!r.text.includes("none captured yet"), "the contact line does not assert nothing was captured");
  assert.ok(!r.text.includes("That is the team-design route"), "the order is not reclassified as team-designed");
  // And it names the binding arguments that fix it.
  assert.ok(r.text.includes("contactEmail"), "the recap text names the contactEmail argument");
  assert.ok(r.text.includes("artworkRef"), "the recap text names the artworkRef argument");
  const s = r.structured as { customer: { binding: string } };
  assert.ok(!s.customer.binding.includes("no contact email has been captured"), "the structured binding asserts no false negative");
  assert.ok(s.customer.binding.includes("contactEmail"), "the structured binding names contactEmail");
});

test("R1: the intent and the questions name the binding arguments", async () => {
  const env = makeEnv();
  const fetchFn = stubFetch() as unknown as typeof fetch;
  const intent = await runTool(env, req(), "start_order_intent", { email: ROBIN_EMAIL, organizationName: ROBIN_ORG }, fetchFn);
  const is = intent.structured as { nextStep: string };
  assert.ok(is.nextStep.includes("contactEmail"), "the intent's next step names contactEmail as a get_recap argument");
  assert.ok(is.nextStep.includes("artworkRef"), "the intent's next step names artworkRef as a get_recap argument");
  const q = await runTool(env, req(), "get_order_questions", {}, fetchFn);
  assert.ok(q.text.includes("contactEmail"), "the questions text names contactEmail");
  const qs = q.structured as { questions: Array<{ field: string; note?: string }> };
  const q1 = qs.questions.find((x) => x.field === "contactEmail");
  assert.ok((q1?.note ?? "").includes("contactEmail"), "question 1's note names the contactEmail argument");
});

test("R2: the WELCOME10 window ends 7 days after the quote date", async () => {
  const env = makeEnv();
  const fetchFn = stubFetch() as unknown as typeof fetch;
  const r = await runTool(env, req(), "get_recap", {
    contactEmail: ROBIN_EMAIL, organizationName: ROBIN_ORG,
    quantity: 100, size: "100mm-round", mounting: "adhesive", shipTo: SHIP_TO,
  }, fetchFn);
  const s = r.structured as { priceHold: { quotedOn: string } };
  const m = r.text.match(/within 7 days of this quote \(by (\d{4}-\d{2}-\d{2})\)/);
  assert.ok(m, "the window line carries a date");
  const expected = new Date(new Date(`${s.priceHold.quotedOn}T00:00:00Z`).getTime() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  assert.equal(m![1], expected, "the parenthetical is the quote date plus 7 days");
  assert.notEqual(m![1], s.priceHold.quotedOn, "the window does not end on the quote date itself");
});

test("R3: the placement headline total is the invoice's total", async () => {
  const env = makeEnv();
  const fetchFn = stubFetch() as unknown as typeof fetch;
  await runTool(env, req(), "start_order_intent", { email: ROBIN_EMAIL, organizationName: ROBIN_ORG }, fetchFn);
  const recap = await runTool(env, req(), "get_recap", {
    contactEmail: ROBIN_EMAIL, organizationName: ROBIN_ORG,
    quantity: 100, size: "100mm-round", mounting: "adhesive", shipTo: SHIP_TO,
  }, fetchFn);
  const order = await runTool(env, req(), "create_order", {
    contactName: "Robin Ellis", contactEmail: ROBIN_EMAIL, contactPhone: "+17135550199",
    organizationName: ROBIN_ORG,
    quantity: 100, size: "100mm-round", mounting: "adhesive", shipTo: SHIP_TO,
    recapRef: recap.structured.recapRef as string, idempotencyKey: "robin-fix-r3-0001", exit: "pay_now",
  }, fetchFn);
  const s = order.structured as { invoice: { totalCents: number } | null };
  assert.ok(s.invoice, "an invoice was minted");
  assert.equal(s.invoice!.totalCents, 45000, "the invoice carries the discounted first-order total");
  assert.ok(order.text.includes("Total: $450.00 for 100 discs"), "the headline total reads from the invoice");
  assert.ok(!order.text.includes("Total: $500.00"), "the headline never shows the list total as the total");
});
