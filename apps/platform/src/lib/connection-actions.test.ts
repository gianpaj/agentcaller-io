import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  human: vi.fn(),
  find: vi.fn(),
  ensure: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("./portal", () => ({
  requireHumanSession: state.human,
  findClientProfileForUser: state.find,
  ensureClientProfileForUser: state.ensure,
}));
vi.mock("./oauth-consent", () => ({ revokeAgentConnection: state.revoke }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { disconnectAgent } from "../app/app/connections/actions";
const user = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
function form() {
  const input = new FormData();
  input.set("connection_id", connectionId);
  return input;
}
beforeEach(() => {
  vi.resetAllMocks();
  state.human.mockResolvedValue({ user: { id: user } });
  state.find.mockResolvedValue({ id: "own-profile" });
  state.revoke.mockResolvedValue(null);
});
describe("disconnect integration action", () => {
  it("revokes only within the signed-in human's profile", async () => {
    await disconnectAgent(form());
    expect(state.find).toHaveBeenCalledWith(user);
    expect(state.revoke).toHaveBeenCalledWith("own-profile", connectionId);
  });
  it("never provisions a profile", async () => {
    state.find.mockResolvedValue(null);
    await disconnectAgent(form());
    expect(state.ensure).not.toHaveBeenCalled();
    expect(state.revoke).not.toHaveBeenCalled();
  });
});
