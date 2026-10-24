import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ deleteRoom: vi.fn() }));
vi.mock("livekit-server-sdk", async (original) => ({
  ...(await original<typeof import("livekit-server-sdk")>()),
  RoomServiceClient: class {
    deleteRoom = mocks.deleteRoom;
  },
}));
vi.mock("./env", () => ({
  getLiveKitEnv: () => ({
    LIVEKIT_URL: "wss://offline.example",
    LIVEKIT_API_KEY: "offline",
    LIVEKIT_API_SECRET: "offline",
  }),
}));
import { TwirpError } from "livekit-server-sdk";
import { stopCall } from "./livekit";
beforeEach(() => {
  mocks.deleteRoom.mockReset();
});
it("accepts successful deletion and an explicitly missing room", async () => {
  mocks.deleteRoom
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(
      new TwirpError("Not Found", "room does not exist", 404, "not_found"),
    );
  await expect(stopCall("room")).resolves.toBeUndefined();
  await expect(stopCall("room")).resolves.toBeUndefined();
});
it.each([
  new TwirpError(
    "Unauthorized",
    "private provider detail",
    401,
    "unauthenticated",
  ),
  new TwirpError("Unavailable", "private provider detail", 503, "unavailable"),
  new TwirpError("Not Found", "unexpected endpoint", 404),
  Object.assign(new Error("unverified 404"), {
    status: 404,
    code: "not_found",
  }),
  Object.assign(new Error("network timeout"), { name: "TimeoutError" }),
])(
  "propagates deletion failures that do not confirm room absence: %s",
  async (error) => {
    mocks.deleteRoom.mockRejectedValueOnce(error);
    await expect(stopCall("room")).rejects.toBe(error);
  },
);
