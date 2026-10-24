export async function handleStripePage(route) {
  if (new URL(route.request().url()).origin !== "https://checkout.stripe.com")
    return false;
  await route.fulfill({
    contentType: "text/html",
    body: "<h1>Simulated Stripe Checkout</h1>",
  });
  return true;
}
