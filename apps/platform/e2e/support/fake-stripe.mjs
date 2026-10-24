import { randomUUID } from "node:crypto";
import Stripe from "stripe";

// Reviewed against Stripe Node 23 and the app's existing fakeStripe/fakeInvoices
// builders. API reference: /api/checkout/sessions/retrieve and /api/invoice-payment/list.
export const fixtureStripeApiVersion = Stripe.API_VERSION;
const copy = (value) => structuredClone(value);
const json = (value, status = 200) => Response.json(value, { status });
const fail = (message, status = 400) =>
  json({ error: { type: "invalid_request_error", message } }, status);
const objectId = (value) => (typeof value === "string" ? value : value?.id);
const metadata = (params, prefix = "metadata") =>
  Object.fromEntries(
    [...params]
      .filter(([key]) => key.startsWith(prefix + "["))
      .map(([key, value]) => [key.slice(prefix.length + 1, -1), value]),
  );
const expansions = (params) =>
  [...params]
    .filter(([key]) => /^expand(?:\[\d*\])?$/.test(key))
    .map(([, value]) => value);
const list = (data, path) => ({
  object: "list",
  url: path,
  has_more: false,
  data,
});

export function createStripeFake() {
  let requests,
    objects,
    idempotency,
    events,
    losses,
    unsupported,
    setupMetadata;
  const id = (prefix) => prefix + "_" + randomUUID().replaceAll("-", "");
  const put = (object) => {
    objects.set(object.id, object);
    return object;
  };
  const get = (value, type) => {
    const object = objects.get(value);
    if (!object || (type && object.object !== type))
      throw new Error("Unknown Stripe fixture " + (type ?? "object"));
    return object;
  };
  const all = (type) =>
    [...objects.values()].filter((object) => object.object === type);
  function reset() {
    requests = [];
    objects = new Map();
    idempotency = new Map();
    events = new Map();
    losses = [];
    unsupported = [];
    setupMetadata = new Map();
  }
  reset();

  function expanded(object, params) {
    const result = copy(object);
    const fields = expansions(params);
    if (
      result.object === "checkout.session" &&
      result.setup_intent &&
      fields.some((key) => key.startsWith("setup_intent"))
    ) {
      result.setup_intent = copy(
        get(objectId(result.setup_intent), "setup_intent"),
      );
      if (
        result.setup_intent.payment_method &&
        fields.includes("setup_intent.payment_method")
      )
        result.setup_intent.payment_method = copy(
          get(objectId(result.setup_intent.payment_method), "payment_method"),
        );
    }
    return result;
  }
  function completeCheckout(input) {
    const session = get(input.sessionId, "checkout.session");
    if (session.status === "expired")
      throw new Error("Cannot complete an expired Session");
    if (session.status !== "complete") {
      const method = put({
        id: id("pm"),
        object: "payment_method",
        type: "card",
        livemode: false,
        customer: input.cardCustomerId ?? session.customer,
        card: {
          brand: "visa",
          last4: "4242",
          exp_month: 12,
          exp_year: new Date().getUTCFullYear() + 4,
        },
      });
      const intent = put({
        id: id("seti"),
        object: "setup_intent",
        status: "succeeded",
        usage: "off_session",
        livemode: false,
        customer: input.intentCustomerId ?? session.customer,
        metadata: copy(setupMetadata.get(session.id)),
        payment_method: method.id,
      });
      session.status = "complete";
      session.setup_intent = intent.id;
      if (input.sessionCustomerId) session.customer = input.sessionCustomerId;
    }
    return {
      sessionId: session.id,
      customerId: session.customer,
      paymentMethodId: get(session.setup_intent).payment_method,
      setupIntentId: session.setup_intent,
      returnUrl: session.success_url,
    };
  }
  function invoiceOutcome(input) {
    const invoice = get(input.invoiceId, "invoice");
    if (
      !["paid", "failed", "action_required", "paid_without_cash"].includes(
        input.outcome,
      )
    )
      throw new Error("Unsupported simulated collection outcome");
    if (invoice.status === "draft")
      throw new Error("Finalize an invoice before simulating collection");
    invoice.attempted = true;
    invoice.status = ["paid", "paid_without_cash"].includes(input.outcome)
      ? "paid"
      : "open";
    invoice.amount_paid = invoice.status === "paid" ? invoice.total : 0;
    invoice.amount_remaining = invoice.status === "paid" ? 0 : invoice.total;
    invoice.last_finalization_error = null;
    invoice.last_payment_error =
      input.outcome === "paid"
        ? null
        : {
            code:
              input.outcome === "action_required"
                ? "authentication_required"
                : "card_declined",
          };
    if (
      input.outcome === "paid" &&
      !all("invoice_payment").some((payment) => payment.invoice === invoice.id)
    ) {
      const intentId = id("pi");
      const charge = put({
        id: id("ch"),
        object: "charge",
        customer: invoice.customer,
        payment_intent: intentId,
        paid: true,
        status: "succeeded",
        refunded: false,
        disputed: false,
        amount_refunded: 0,
        amount: invoice.total,
        livemode: false,
        currency: "usd",
        payment_method: invoice.default_payment_method,
        payment_method_details: { type: "card" },
      });
      const intent = put({
        id: intentId,
        object: "payment_intent",
        status: "succeeded",
        customer: invoice.customer,
        livemode: false,
        currency: "usd",
        amount: invoice.total,
        amount_received: invoice.total,
        latest_charge: charge.id,
      });
      put({
        id: id("inpay"),
        object: "invoice_payment",
        invoice: invoice.id,
        status: "paid",
        livemode: false,
        currency: "usd",
        amount_paid: invoice.total,
        amount_requested: invoice.total,
        payment: { type: "payment_intent", payment_intent: intent.id },
      });
    }
    return {
      invoiceId: invoice.id,
      status: invoice.status,
      outcome: input.outcome,
    };
  }

  async function handle(input, params, url) {
    const path = url.pathname;
    if (input.method === "POST" && path === "/v1/customers")
      return put({
        id: id("cus"),
        object: "customer",
        livemode: false,
        metadata: metadata(params),
        invoice_settings: { default_payment_method: null },
      });
    if (path.startsWith("/v1/customers/")) {
      const customer = get(path.split("/").at(-1), "customer");
      if (input.method === "POST") {
        if (params.has("email")) customer.email = params.get("email");
        return customer;
      }
      if (input.method === "GET") return customer;
    }
    if (input.method === "POST" && path === "/v1/checkout/sessions") {
      get(params.get("customer"), "customer");
      if (params.get("mode") !== "setup" || params.get("currency") !== "usd")
        throw new Error("Only USD setup mode is modeled");
      const sessionId = id("cs");
      setupMetadata.set(
        sessionId,
        metadata(params, "setup_intent_data[metadata]"),
      );
      return put({
        id: sessionId,
        object: "checkout.session",
        mode: "setup",
        currency: "usd",
        customer: params.get("customer"),
        status: "open",
        livemode: false,
        payment_status: "no_payment_required",
        payment_intent: null,
        setup_intent: null,
        client_reference_id: params.get("client_reference_id"),
        metadata: metadata(params),
        expires_at: Number(params.get("expires_at")),
        success_url: params.get("success_url"),
        cancel_url: params.get("cancel_url"),
        url: "https://checkout.stripe.com/c/pay/" + sessionId,
      });
    }
    if (input.method === "GET" && path.startsWith("/v1/checkout/sessions/"))
      return expanded(get(path.split("/").at(-1), "checkout.session"), params);
    for (const [prefix, type] of [
      ["setup_intents", "setup_intent"],
      ["payment_methods", "payment_method"],
      ["payment_intents", "payment_intent"],
      ["charges", "charge"],
    ]) {
      if (input.method === "GET" && path.startsWith("/v1/" + prefix + "/"))
        return get(path.split("/").at(-1), type);
    }
    if (input.method === "POST" && path === "/v1/invoices") {
      get(params.get("customer"), "customer");
      const method = get(
        params.get("default_payment_method"),
        "payment_method",
      );
      if (
        method.customer !== params.get("customer") ||
        params.get("currency") !== "usd" ||
        params.get("pending_invoice_items_behavior") !== "exclude" ||
        params.get("collection_method") !== "charge_automatically" ||
        params.get("auto_advance") !== "false"
      )
        throw new Error("Unexpected monthly invoice configuration");
      const invoiceId = id("in");
      return put({
        id: invoiceId,
        object: "invoice",
        livemode: false,
        customer: params.get("customer"),
        currency: "usd",
        collection_method: "charge_automatically",
        auto_advance: false,
        default_payment_method: method.id,
        payment_settings: { payment_method_types: ["card"] },
        metadata: metadata(params),
        parent: null,
        status: "draft",
        total: 0,
        amount_due: 0,
        amount_paid: 0,
        amount_remaining: 0,
        amount_overpaid: 0,
        starting_balance: 0,
        pre_payment_credit_notes_amount: 0,
        post_payment_credit_notes_amount: 0,
        total_discount_amounts: [],
        total_taxes: [],
        attempted: false,
        hosted_invoice_url: "https://invoice.stripe.com/i/" + invoiceId,
      });
    }
    if (input.method === "GET" && path === "/v1/invoices")
      return list(
        all("invoice").filter(
          (invoice) =>
            !params.get("customer") ||
            invoice.customer === params.get("customer"),
        ),
        path,
      );
    if (input.method === "POST" && path === "/v1/invoiceitems") {
      const invoice = get(params.get("invoice"), "invoice");
      if (
        invoice.status !== "draft" ||
        invoice.customer !== params.get("customer") ||
        params.get("currency") !== "usd"
      )
        throw new Error("Invoice item ownership mismatch");
      const amount = Number(params.get("amount"));
      if (!Number.isSafeInteger(amount) || amount <= 0)
        throw new Error("Positive integer invoice item required");
      const item = put({
        id: id("ii"),
        object: "invoiceitem",
        invoice: invoice.id,
        customer: invoice.customer,
        amount,
        currency: "usd",
        metadata: metadata(params),
        description: params.get("description"),
      });
      put({
        id: id("il"),
        object: "line_item",
        invoice: invoice.id,
        amount,
        currency: "usd",
        metadata: copy(item.metadata),
        parent: {
          type: "invoice_item_details",
          invoice_item_details: { invoice_item: item.id },
        },
      });
      invoice.total += amount;
      invoice.amount_due = invoice.total;
      invoice.amount_remaining = invoice.total;
      return item;
    }
    const invoiceRoute = path.match(
      /^\/v1\/invoices\/([^/]+)(?:\/(lines|finalize))?$/,
    );
    if (invoiceRoute) {
      const invoice = get(invoiceRoute[1], "invoice");
      if (input.method === "GET" && invoiceRoute[2] === "lines")
        return list(
          all("line_item").filter((line) => line.invoice === invoice.id),
          path,
        );
      if (input.method === "GET" && !invoiceRoute[2]) return invoice;
      if (input.method === "POST") {
        if (params.has("default_payment_method")) {
          const method = get(
            params.get("default_payment_method"),
            "payment_method",
          );
          if (method.customer !== invoice.customer)
            throw new Error("Foreign default card");
          invoice.default_payment_method = method.id;
        }
        if (params.has("auto_advance"))
          invoice.auto_advance = params.get("auto_advance") === "true";
        if (invoiceRoute[2] === "finalize") invoice.status = "open";
        return invoice;
      }
    }
    if (input.method === "GET" && path === "/v1/invoice_payments") {
      const data = all("invoice_payment")
        .filter(
          (payment) =>
            (!params.get("invoice") ||
              payment.invoice === params.get("invoice")) &&
            (!params.get("status") || payment.status === params.get("status")),
        )
        .map((payment) => {
          const result = copy(payment);
          if (
            expansions(params).includes(
              "data.payment.payment_intent.latest_charge",
            )
          ) {
            result.payment.payment_intent = copy(
              get(payment.payment.payment_intent, "payment_intent"),
            );
            result.payment.payment_intent.latest_charge = copy(
              get(result.payment.payment_intent.latest_charge, "charge"),
            );
          }
          return result;
        });
      return list(data, path);
    }
    unsupported.push({ method: input.method, path });
    return null;
  }
  return {
    reset,
    snapshot() {
      return {
        apiVersion: fixtureStripeApiVersion,
        requests: copy(requests),
        objects: copy([...objects.values()]),
        unsupported: copy(unsupported),
      };
    },
    async control(action, input = {}) {
      if (action === "complete-checkout") return completeCheckout(input);
      if (action === "expire-checkout") {
        const session = get(input.sessionId, "checkout.session");
        session.status = "expired";
        return { sessionId: session.id };
      }
      if (action === "invoice-outcome") return invoiceOutcome(input);
      if (action === "lose-response") {
        losses.push({
          method: input.method ?? "POST",
          path: input.path,
          remaining: input.count ?? 2,
        });
        return { configured: true };
      }
      if (action === "event") {
        const object = get(input.objectId);
        const eventId = input.eventId ?? id("evt");
        if (!events.has(eventId))
          events.set(eventId, {
            id: eventId,
            object: "event",
            type: input.type,
            api_version: fixtureStripeApiVersion,
            livemode: false,
            created: Math.floor(Date.now() / 1000),
            data: { object: copy(object) },
          });
        return copy(events.get(eventId));
      }
      throw new Error("Unsupported Stripe fixture operation");
    },
    async request(input) {
      if (input.headers.authorization !== "Bearer sk_test_e2e")
        return fail("Synthetic key required", 401);
      if (input.headers["stripe-version"] !== fixtureStripeApiVersion)
        return fail("Fixture version differs from SDK request");
      const url = new URL(input.path, "https://api.stripe.com");
      const params =
        input.method === "GET"
          ? url.searchParams
          : new URLSearchParams(input.body);
      const key = input.headers["idempotency-key"];
      requests.push({
        method: input.method,
        path: input.path,
        idempotencyKey: key ?? null,
      });
      const operation = key
        ? input.method + ":" + url.pathname + ":" + key
        : undefined;
      try {
        let response;
        const previous = operation && idempotency.get(operation);
        if (previous) {
          if (previous.body !== input.body)
            return fail("Idempotency key reused with different input");
          response = copy(previous.response);
        } else {
          response = await handle(input, params, url);
          if (!response) return fail("Unsupported Stripe fixture request", 501);
          if (operation)
            idempotency.set(operation, {
              body: input.body,
              response: copy(response),
            });
        }
        const lost = losses.find(
          (fault) =>
            fault.method === input.method &&
            fault.path === url.pathname &&
            fault.remaining > 0,
        );
        if (lost) {
          lost.remaining--;
          return json(
            {
              error: {
                type: "api_error",
                message: "Simulated response loss after provider commit",
              },
            },
            503,
          );
        }
        return json(response);
      } catch (error) {
        return fail(error.message);
      }
    },
  };
}
