import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ human: vi.fn(), details: vi.fn() }));
vi.mock("./portal", () => ({ requireHumanSession: state.human }));
vi.mock("./mcp-config", () => ({ isMcpEnabled: () => true }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("../app/oauth/consent/actions", () => ({
  decideOAuthConsent: vi.fn(),
}));
import OAuthConsentPage from "../app/oauth/consent/page";
const user = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const details = {
  user: { id: user },
  authorization_id: id,
  client: { id: "33333333-3333-4333-8333-333333333333", name: "Host" },
  redirect_uri: "https://host.example/callback",
  scope: "openid",
};
async function render() {
  const page = await OAuthConsentPage({
    searchParams: Promise.resolve({ authorization_id: id }),
  });
  return JSON.stringify(page);
}
beforeEach(() => {
  vi.resetAllMocks();
  state.human.mockResolvedValue({
    user: { id: user, email: "human@example.com" },
    supabase: { auth: { oauth: { getAuthorizationDetails: state.details } } },
  });
  state.details.mockResolvedValue({ data: details, error: null });
});
describe("OAuth consent page", () => {
  it("renders consent for a supported client", async () => {
    expect(await render()).toContain("Allow tool access");
  });
  it("blocks Allow without the consent box but lets Deny through", async () => {
    const page = await render();
    expect(page).toMatch(/"name":"consent","value":"yes","required":true/);
    expect(page).toMatch(/"value":"deny","formNoValidate":true/);
  });
  it.each([
    ["an empty client name", { client: { ...details.client, name: "" } }],
    ["a custom-scheme redirect", { redirect_uri: "cursor://oauth/callback" }],
  ])("shows the unavailable state for %s", async (_, override) => {
    state.details.mockResolvedValue({
      data: { ...details, ...override },
      error: null,
    });
    const page = await render();
    expect(page).toContain("Connection unavailable");
    expect(page).not.toContain("Allow tool access");
  });
});
