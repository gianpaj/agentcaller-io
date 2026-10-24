import { stripeCommand, stripeState } from "./billing.mjs";

export async function handleStripePage(route) {
  const url = new URL(route.request().url());
  if (url.origin === "https://checkout.stripe.com") {
    const session = (await stripeState()).objects.find(
      (object) =>
        object.object === "checkout.session" &&
        object.url === url.origin + url.pathname,
    );
    if (!session) {
      await route.fulfill({ status: 404, body: "Unknown simulated Checkout" });
      return true;
    }
    if (route.request().method() === "POST") {
      const completed = await stripeCommand("complete-checkout", {
        sessionId: session.id,
      });
      await route.fulfill({
        status: 303,
        headers: { location: completed.returnUrl },
        body: "",
      });
      return true;
    }
    await route.fulfill({
      contentType: "text/html",
      body: '<h1>Simulated Stripe Checkout</h1><p>No payment is charged during setup.</p><form method="post"><button>Complete simulated card setup</button></form>',
    });
    return true;
  }
  if (url.origin === "https://invoice.stripe.com") {
    const invoice = (await stripeState()).objects.find(
      (object) =>
        object.object === "invoice" &&
        object.hosted_invoice_url === url.origin + url.pathname,
    );
    if (!invoice) {
      await route.fulfill({ status: 404, body: "Unknown simulated invoice" });
      return true;
    }
    if (route.request().method() === "POST") {
      await stripeCommand("invoice-outcome", {
        invoiceId: invoice.id,
        outcome: "paid",
      });
      await route.fulfill({
        contentType: "text/html",
        body: "<h1>Simulated invoice paid</h1>",
      });
    } else
      await route.fulfill({
        contentType: "text/html",
        body: '<h1>Simulated Stripe invoice</h1><form method="post"><button>Complete simulated invoice payment</button></form>',
      });
    return true;
  }
  return false;
}
