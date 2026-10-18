import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClaims: vi.fn(),
  database: vi.fn(),
  rows: vi.fn(),
}));
vi.mock("./supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: state.getUser, getClaims: state.getClaims },
  }),
}));
vi.mock("./database", () => ({ database: state.database }));
import { loadClientProfile, requireHumanSession } from "./portal";
const uid = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  state.getUser.mockResolvedValue({
    data: {
      user: {
        id: uid,
        is_anonymous: false,
        user_metadata: { client_id: "untrusted-display-data" },
      },
    },
    error: null,
  });
  state.getClaims.mockResolvedValue({
    data: { claims: { sub: uid } },
    error: null,
  });
  state.database.mockReturnValue({
    select: () => ({ from: () => ({ where: () => ({ limit: state.rows }) }) }),
  });
  state.rows.mockResolvedValue([
    { id: "own-profile", enabled: true, webhookSecret: "already-set" },
  ]);
});
describe("human portal boundary", () => {
  it("accepts verified human identity and ignores writable metadata", async () => {
    expect((await requireHumanSession()).user.id).toBe(uid);
    expect((await loadClientProfile()).profile?.id).toBe("own-profile");
  });
  it("rejects delegated OAuth credentials as human portal authority", async () => {
    state.getClaims.mockResolvedValue({
      data: { claims: { sub: uid, client_id: "verified-oauth-client" } },
      error: null,
    });
    await expect(requireHumanSession()).rejects.toMatchObject({ status: 403 });
    expect((await loadClientProfile()).profile).toBeNull();
    expect(state.database).not.toHaveBeenCalled();
  });
  it("rejects anonymous or mismatched verification before profile access", async () => {
    state.getUser.mockResolvedValueOnce({
      data: { user: { id: uid, is_anonymous: true } },
      error: null,
    });
    await expect(requireHumanSession()).rejects.toMatchObject({ status: 403 });
    state.getClaims.mockResolvedValue({
      data: { claims: { sub: "other-user" } },
      error: null,
    });
    await expect(requireHumanSession()).rejects.toMatchObject({ status: 401 });
    expect((await loadClientProfile()).profile).toBeNull();
    expect(state.database).not.toHaveBeenCalled();
  });
  it("does not treat failed verification as an authenticated human", async () => {
    state.getClaims.mockResolvedValue({
      data: null,
      error: new Error("Invalid token"),
    });
    await expect(requireHumanSession()).rejects.toMatchObject({ status: 401 });
    expect((await loadClientProfile()).profile).toBeNull();
  });
});
