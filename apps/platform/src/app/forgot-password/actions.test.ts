import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requestReset: vi.fn(),
}));

vi.mock("@/lib/auth-redirect", () => ({
  getPasswordRecoveryCallbackUrl: () =>
    "https://agentcaller.example/auth/callback?next=%2Freset-password",
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { requestPasswordReset } from "./actions";

describe("requestPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: { resetPasswordForEmail: mocks.requestReset },
    });
    mocks.requestReset.mockResolvedValue({ error: null });
  });

  it("sends a recovery link through the application callback", async () => {
    const form = new FormData();
    form.set("email", "operator@example.com");

    await expect(
      requestPasswordReset({ error: "", submitted: false }, form),
    ).resolves.toEqual({ error: "", submitted: true });
    expect(mocks.requestReset).toHaveBeenCalledWith("operator@example.com", {
      redirectTo:
        "https://agentcaller.example/auth/callback?next=%2Freset-password",
    });
  });

  it("rejects an invalid email before calling Supabase", async () => {
    const form = new FormData();

    await expect(
      requestPasswordReset({ error: "", submitted: false }, form),
    ).resolves.toMatchObject({ submitted: false });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("reports an email rate limit without exposing account existence", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.requestReset.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", status: 429 },
    });
    const form = new FormData();
    form.set("email", "operator@example.com");

    await expect(
      requestPasswordReset({ error: "", submitted: false }, form),
    ).resolves.toEqual({
      error: "Too many reset emails were requested. Wait and try again later.",
      submitted: false,
    });
  });
});
