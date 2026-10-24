import { randomUUID } from "node:crypto";

export function createStripeFake() {
  let requests = [];
  let objects = new Map();
  const id = (prefix) => prefix + "_" + randomUUID().replaceAll("-", "");
  return {
    reset() {
      requests = [];
      objects = new Map();
    },
    snapshot() {
      return {
        requests: requests.map(({ method, path }) => ({ method, path })),
        objects: [...objects.values()],
      };
    },
    async control() {
      throw new Error("Unsupported Stripe fixture operation");
    },
    async request(input) {
      if (input.headers.authorization !== "Bearer sk_test_e2e")
        return Response.json(
          { error: { message: "Synthetic key required" } },
          { status: 401 },
        );
      requests.push({ method: input.method, path: input.path });
      const params = new URLSearchParams(input.body);
      if (input.method === "POST" && input.path === "/v1/customers") {
        const object = {
          id: id("cus"),
          object: "customer",
          livemode: false,
          metadata: Object.fromEntries(
            [...params]
              .filter(([key]) => key.startsWith("metadata["))
              .map(([key, value]) => [key.slice(9, -1), value]),
          ),
        };
        objects.set(object.id, object);
        return Response.json(object);
      }
      if (input.method === "POST" && input.path.startsWith("/v1/customers/")) {
        const object = objects.get(input.path.split("/").at(-1));
        if (!object)
          return Response.json(
            { error: { message: "Unknown test customer" } },
            { status: 404 },
          );
        Object.assign(object, Object.fromEntries(params));
        return Response.json(object);
      }
      if (input.method === "POST" && input.path === "/v1/checkout/sessions") {
        const object = {
          id: id("cs"),
          object: "checkout.session",
          mode: params.get("mode"),
          currency: params.get("currency"),
          customer: params.get("customer"),
          status: "open",
          livemode: false,
          setup_intent: null,
          client_reference_id: params.get("client_reference_id"),
          metadata: Object.fromEntries(
            [...params]
              .filter(([key]) => key.startsWith("metadata["))
              .map(([key, value]) => [key.slice(9, -1), value]),
          ),
          success_url: params.get("success_url"),
          cancel_url: params.get("cancel_url"),
          url: "https://checkout.stripe.com/c/pay/" + id("e2e"),
        };
        objects.set(object.id, object);
        return Response.json(object);
      }
      return Response.json(
        { error: { message: "Unsupported Stripe fixture request" } },
        { status: 501 },
      );
    },
  };
}
