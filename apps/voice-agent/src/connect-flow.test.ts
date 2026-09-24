import { afterEach, describe, expect, it, vi } from "vitest";
import { connectMeTaskSchema } from "@agentcaller/contracts";
import {
  runConnectFlow,
  sipFailure,
  businessMessage,
  callbackMessage,
  CallStopped,
  type ConnectIO,
} from "./connect-flow";
const task = connectMeTaskSchema.parse({
  type: "connect_me",
  callbackNumber: "+34612345678",
  callbackLanguage: "es",
  purpose: "Post office",
  callingWindow: {
    timezone: "Europe/Madrid",
    weekdays: [1],
    start: "09:00",
    end: "17:00",
  },
  expiresAt: "2030-01-01T00:00:00Z",
});
const input = {
  destination: "+34911234567",
  destinationCountry: "ES" as const,
  language: "es" as const,
  maxDurationSeconds: 900,
  maxAmountUsd: 10,
  task,
};
function harness() {
  const abort = new AbortController();
  const order: string[] = [];
  const io: ConnectIO = {
    signal: abort.signal,
    command: vi.fn(async (action, fields) => {
      order.push(`${action}:${fields?.leg ?? ""}`);
      return true;
    }),
    dial: vi.fn(async (leg) => {
      order.push(`dial-${leg}`);
    }),
    classify: vi.fn(async () => "human" as const),
    informBusiness: vi.fn(async () => {
      order.push("inform");
    }),
    acceptCallback: vi.fn(async () => true),
    silence: vi.fn(async () => {
      order.push("silence");
    }),
    bridge: vi.fn(async () => {
      order.push("bridge");
    }),
    conversation: vi.fn(async () => {}),
    cleanup: vi.fn(async () => {
      abort.abort(new CallStopped("cancelled"));
    }),
  };
  return { io, abort, order };
}
afterEach(() => vi.useRealTimers());
describe("connect workflow", () => {
  it("informs business, requires acceptance, silences before joining, retains ownership through conversation", async () => {
    const { io, order } = harness();
    expect(await runConnectFlow(input, io)).toBe("connected");
    expect(order.indexOf("inform")).toBeLessThan(
      order.indexOf("dial-callback"),
    );
    expect(order.indexOf("accept:")).toBeLessThan(order.indexOf("silence"));
    expect(order.indexOf("silence")).toBeLessThan(order.indexOf("bridge"));
    expect(io.conversation).toHaveBeenCalledOnce();
    expect(io.cleanup).toHaveBeenCalledOnce();
  });
  it.each([
    "voicemail",
    "ivr_unresolved",
    "uncertain_answer",
    "refused",
  ] as const)("stops on %s without calling mobile", async (outcome) => {
    const { io } = harness();
    vi.mocked(io.classify).mockResolvedValue(outcome);
    expect(await runConnectFlow(input, io)).toBe(outcome);
    expect(io.dial).toHaveBeenCalledTimes(1);
    expect(io.bridge).not.toHaveBeenCalled();
  });
  it.each(["busy", "no_answer", "routing_denied", "dial_unknown"] as const)(
    "reports %s for durable scheduling",
    async (reason) => {
      const { io } = harness();
      vi.mocked(io.dial).mockRejectedValue(new CallStopped(reason));
      expect(await runConnectFlow(input, io)).toBe(reason);
      expect(io.command).toHaveBeenLastCalledWith("finish", { reason });
    },
  );
  it("declines rather than retrying after callback rejection", async () => {
    const { io } = harness();
    vi.mocked(io.acceptCallback).mockResolvedValue(false);
    expect(await runConnectFlow(input, io)).toBe("callback_declined");
    expect(io.bridge).not.toHaveBeenCalled();
  });
  it("callback voicemail or silence cannot accept", async () => {
    vi.useFakeTimers();
    const { io } = harness();
    vi.mocked(io.acceptCallback).mockReturnValue(new Promise(() => {}));
    const result = runConnectFlow(input, io);
    await vi.advanceTimersByTimeAsync(16000);
    expect(await result).toBe("callback_timeout");
    expect(io.bridge).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "business_hangup"] as const)(
    "rejects acceptance racing %s",
    async (reason) => {
      const { io, abort } = harness();
      vi.mocked(io.acceptCallback).mockImplementation(async () => {
        abort.abort(new CallStopped(reason));
        return true;
      });
      expect(await runConnectFlow(input, io)).toBe(reason);
      expect(io.bridge).not.toHaveBeenCalled();
    },
  );
  it("defers a closed window instead of cancelling", async () => {
    const { io } = harness();
    vi.mocked(io.command).mockResolvedValue("deferred");
    expect(await runConnectFlow(input, io)).toBe("outside_window");
    expect(io.dial).not.toHaveBeenCalled();
    expect(io.command).toHaveBeenLastCalledWith("finish", {
      reason: "outside_window",
    });
  });
  it("never dials without durable permission", async () => {
    const { io } = harness();
    vi.mocked(io.command).mockResolvedValue(false);
    expect(await runConnectFlow(input, io)).toBe("cancelled");
    expect(io.dial).not.toHaveBeenCalled();
  });
  it("caps waiting and conversation time", async () => {
    vi.useFakeTimers();
    for (const [operation, seconds, reason] of [
      ["classify", task.waitingSeconds, "uncertain_answer"],
      ["conversation", task.conversationSeconds, "duration_limit"],
    ] as const) {
      const { io } = harness();
      vi.mocked(io[operation]).mockReturnValue(new Promise<never>(() => {}));
      const result = runConnectFlow(input, io);
      await vi.advanceTimersByTimeAsync((seconds + 1) * 1000);
      expect(await result).toBe(reason);
      expect(io.cleanup).toHaveBeenCalledOnce();
    }
  });
  it("treats a dial transport timeout as unknown, not no-answer", async () => {
    vi.useFakeTimers();
    const { io } = harness();
    vi.mocked(io.dial).mockReturnValue(new Promise(() => {}));
    const result = runConnectFlow(input, io);
    await vi.advanceTimersByTimeAsync(56000);
    expect(await result).toBe("dial_unknown");
    expect(io.dial).toHaveBeenCalledTimes(1);
  });
  it("distinguishes explicit SIP outcomes", () => {
    expect(sipFailure(486)).toBe("busy");
    expect(sipFailure(480)).toBe("no_answer");
    expect(sipFailure(603)).toBe("refused");
    expect(sipFailure(403)).toBe("routing_denied");
    expect(sipFailure(503)).toBe("configuration_error");
    expect(sipFailure()).toBe("dial_unknown");
  });
  it("discloses automation in both business languages and independently prompts callback", () => {
    expect(businessMessage.es).toContain("asistente automático");
    expect(businessMessage.it).toContain("assistente automatico");
    expect(callbackMessage.es).toContain("Pulse 1");
    expect(callbackMessage.it).toContain("Prema 1");
    expect(callbackMessage.en).toContain("Press 1");
  });
});
