import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  human: vi.fn(),
  ensure: vi.fn(),
  approve: vi.fn(),
  details: vi.fn(),
  allow: vi.fn(),
  deny: vi.fn(),
}));
vi.mock("./portal", () => ({
  requireHumanSession: state.human,
  ensureClientProfileForUser: state.ensure,
}));
vi.mock("./oauth-consent", async (original) => ({
  ...(await original<typeof import("./oauth-consent")>()),
  approveAgentConnection: state.approve,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("./mcp-config", () => ({
  isMcpEnabled: () => true,
  getMcpConfig: () => ({ issuer: "https://issuer.example/auth/v1" }),
}));
import { decideOAuthConsent } from "../app/oauth/consent/actions";
const user = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const details = {
  user: { id: user },
  authorization_id: id,
  client: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Test integration",
  },
  redirect_uri: "https://host.example/callback",
  scope: "openid",
};
function form(approved: boolean) {
  const input = new FormData();
  input.set("authorization_id", id);
  input.set("decision", approved ? "approve" : "deny");
  if (approved) input.set("consent", "yes");
  return input;
}
beforeEach(() => {
  vi.resetAllMocks();
  state.human.mockResolvedValue({
    user: { id: user },
    supabase: {
      auth: {
        oauth: {
          getAuthorizationDetails: state.details,
          approveAuthorization: state.allow,
          denyAuthorization: state.deny,
        },
      },
    },
  });
  state.details.mockResolvedValue({ data: details, error: null });
  state.ensure.mockResolvedValue({ id: "own-profile" });
  state.allow.mockResolvedValue({
    data: { redirect_url: "https://host.example/callback?code=synthetic" },
    error: null,
  });
  state.deny.mockResolvedValue({
    data: { redirect_url: "https://host.example/callback?error=access_denied" },
    error: null,
  });
});
describe("human OAuth consent action", () => {
  it("persists separate tool consent before approving the issuer request", async () => {
    await expect(decideOAuthConsent(form(true))).rejects.toThrow(
      "redirect:https://host.example/callback?code=",
    );
    expect(state.ensure).toHaveBeenCalledWith(user);
    expect(state.approve).toHaveBeenCalledWith(
      "own-profile",
      user,
      "https://issuer.example/auth/v1",
      details,
    );
    expect(state.approve.mock.invocationCallOrder[0]).toBeLessThan(
      state.allow.mock.invocationCallOrder[0]!,
    );
  });
  it("denies without creating a profile or connection", async () => {
    await expect(decideOAuthConsent(form(false))).rejects.toThrow(
      "access_denied",
    );
    expect(state.deny).toHaveBeenCalled();
    expect(state.ensure).not.toHaveBeenCalled();
    expect(state.approve).not.toHaveBeenCalled();
  });
  it("requires explicit spending-independent tool consent", async () => {
    const input = form(true);
    input.delete("consent");
    await expect(decideOAuthConsent(input)).rejects.toThrow("access_denied");
    expect(state.allow).not.toHaveBeenCalled();
  });
  it("rejects mismatched owner or revoked connection without issuer approval", async () => {
    state.details.mockResolvedValueOnce({
      data: { ...details, user: { id } },
      error: null,
    });
    await expect(decideOAuthConsent(form(true))).rejects.toMatchObject({
      status: 403,
    });
    expect(state.approve).not.toHaveBeenCalled();
    state.approve.mockRejectedValue(new Error("Revoked"));
    await expect(decideOAuthConsent(form(true))).rejects.toThrow("Revoked");
    expect(state.allow).not.toHaveBeenCalled();
  });
  it("does not recreate consent on the issuer's already-approved redirect", async () => {
    state.details.mockResolvedValue({
      data: { redirect_url: "https://host.example/callback?code=synthetic" },
      error: null,
    });
    await expect(decideOAuthConsent(form(true))).rejects.toThrow("redirect:");
    expect(state.ensure).not.toHaveBeenCalled();
    expect(state.approve).not.toHaveBeenCalled();
  });
});
