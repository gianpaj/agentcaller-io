import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  redirect: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { updatePassword } from "./actions";

describe("updatePassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: mocks.getUser,
        signOut: mocks.signOut,
        updateUser: mocks.updateUser,
      },
    });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.redirect.mockImplementation(() => {
      throw new Error("redirect");
    });
  });

  it("changes the password and revokes every session", async () => {
    const form = new FormData();
    form.set("password", "new-password");
    form.set("confirmation", "new-password");

    await expect(updatePassword({ error: "" }, form)).rejects.toThrow(
      "redirect",
    );
    expect(mocks.updateUser).toHaveBeenCalledWith({
      password: "new-password",
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?message=password_updated",
    );
  });

  it("does not update a password without an authenticated reset session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const form = new FormData();
    form.set("password", "new-password");
    form.set("confirmation", "new-password");

    await expect(updatePassword({ error: "" }, form)).resolves.toEqual({
      error: "This reset link is invalid or has expired.",
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
