import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  human: vi.fn(),
  find: vi.fn(),
  ensure: vi.fn(),
  invoice: vi.fn(),
  portal: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("./portal", () => ({
  requireHumanSession: state.human,
  findClientProfileForUser: state.find,
  ensureClientProfileForUser: state.ensure,
}));
vi.mock("./billing-invoices", () => ({
  humanInvoiceUrl: state.invoice,
  syncInvoiceCollection: vi.fn(),
}));
vi.mock("./billing-portal", () => ({ humanBillingPortalUrl: state.portal }));
vi.mock("./database", () => ({ database: vi.fn() }));
vi.mock("./connect-scheduler", () => ({ cleanupConnectRooms: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { openBillingPortal, openInvoice } from "../app/app/billing/actions";
const user = "11111111-1111-4111-8111-111111111111";
const invoiceId = "22222222-2222-4222-8222-222222222222";
function form() {
  const input = new FormData();
  input.set("invoiceId", invoiceId);
  return input;
}
beforeEach(() => {
  vi.resetAllMocks();
  state.human.mockResolvedValue({ user: { id: user } });
  state.find.mockResolvedValue({ id: "own-profile" });
  state.invoice.mockResolvedValue("https://invoice.stripe.com/i/x");
});
describe("billing actions", () => {
  it("act only within the signed-in human's profile", async () => {
    await openInvoice(form());
    expect(state.find).toHaveBeenCalledWith(user);
    expect(state.invoice).toHaveBeenCalledWith("own-profile", invoiceId);
  });
  it("never provision a profile", async () => {
    state.find.mockResolvedValue(null);
    await expect(openInvoice(form())).rejects.toThrow("No billing account");
    expect(state.ensure).not.toHaveBeenCalled();
    expect(state.invoice).not.toHaveBeenCalled();
  });
  it("open the billing portal for the signed-in human's profile", async () => {
    state.portal.mockResolvedValue("https://billing.stripe.com/p/session/x");
    await openBillingPortal();
    expect(state.portal).toHaveBeenCalledWith("own-profile");
    expect(state.redirect).toHaveBeenCalledWith(
      "https://billing.stripe.com/p/session/x",
    );
  });
  it("never open a portal without a profile", async () => {
    state.find.mockResolvedValue(null);
    await expect(openBillingPortal()).rejects.toThrow("No billing account");
    expect(state.portal).not.toHaveBeenCalled();
  });
});
