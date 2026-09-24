import {
  type ConnectEvent,
  type ConnectMeTask,
  type CreateCallInput,
} from "@agentcaller/contracts";
export type Reason = NonNullable<ConnectEvent["reason"]>;
export class CallStopped extends Error {
  constructor(public reason: Reason) {
    super(reason);
  }
}
export type Leg = "business" | "callback";
export interface ConnectIO {
  command(
    action: ConnectEvent["action"],
    fields?: Partial<ConnectEvent>,
  ): Promise<boolean>;
  dial(leg: Leg): Promise<void>;
  classify(): Promise<
    "human" | "voicemail" | "ivr_unresolved" | "uncertain_answer" | "refused"
  >;
  informBusiness(): Promise<void>;
  acceptCallback(): Promise<boolean>;
  silence(): Promise<void>;
  bridge(): Promise<void>;
  conversation(): Promise<void>;
  cleanup(): Promise<void>;
  signal: AbortSignal;
}

export async function bounded<T>(
  operation: Promise<T>,
  seconds: number,
  signal: AbortSignal,
  reason: Reason,
): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CallStopped(reason)), seconds * 1000);
    abort = () => reject(signal.reason ?? new CallStopped("cancelled"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, stop]);
  } finally {
    clearTimeout(timer!);
    signal.removeEventListener("abort", abort!);
  }
}

/** Each dial follows a durable, single-use intent. Cleanup never depends on model cooperation. */
export async function runConnectFlow(
  input: CreateCallInput & { task: ConnectMeTask },
  io: ConnectIO,
): Promise<Reason> {
  const task = input.task;
  let reason: Reason = "configuration_error";
  const permit = async (
    action: ConnectEvent["action"],
    fields?: Partial<ConnectEvent>,
  ) => {
    if (io.signal.aborted) throw io.signal.reason;
    if (!(await io.command(action, fields))) throw new CallStopped("cancelled");
    if (io.signal.aborted) throw io.signal.reason;
  };
  try {
    await permit("dial", { leg: "business" });
    await bounded(
      io.dial("business"),
      task.ringingSeconds + 15,
      io.signal,
      "dial_unknown",
    );
    const classification = await bounded(
      io.classify(),
      task.waitingSeconds,
      io.signal,
      "uncertain_answer",
    );
    if (classification !== "human") throw new CallStopped(classification);
    await permit("human");
    await bounded(
      (async () => {
        await io.informBusiness();
        await permit("dial", { leg: "callback" });
        await io.dial("callback");
        const accepted = await bounded(
          io.acceptCallback(),
          task.acceptanceSeconds,
          io.signal,
          "callback_timeout",
        );
        if (!accepted) throw new CallStopped("callback_declined");
        await permit("accept");
        await io.silence();
        await permit("heartbeat");
        await io.bridge();
        await permit("bridged");
      })(),
      task.handoffSeconds,
      io.signal,
      "callback_timeout",
    );
    await bounded(
      io.conversation(),
      task.conversationSeconds,
      io.signal,
      "duration_limit",
    );
    reason = "connected";
  } catch (error) {
    reason =
      error instanceof CallStopped ? error.reason : "configuration_error";
  } finally {
    await io.cleanup();
    await io.command("finish", { reason });
  }
  return reason;
}

export function sipFailure(code?: number): Reason {
  if (code === 486) return "busy";
  if (code === 408 || code === 480) return "no_answer";
  if (code === 603) return "refused";
  if (code === 403 || code === 407) return "routing_denied";
  if (code === 404 || code === 484) return "invalid_destination";
  // A transport timeout has no definitive SIP response and cannot authorize a retry.
  return code ? "configuration_error" : "dial_unknown";
}
export const businessMessage = {
  es: "Hola, soy el asistente automático de Gianfranco. Le conecto con él, un momento, por favor.",
  it: "Buongiorno, sono l’assistente automatico di Gianfranco. La metto in contatto con lui, un momento, per favore.",
};
export const callbackMessage = {
  es: "Soy el asistente automático de AgentCaller. El negocio está en línea. Pulse 1 para aceptar la llamada, o 2 para rechazarla.",
  it: "Sono l’assistente automatico di AgentCaller. L’attività è in linea. Prema 1 per accettare la chiamata, oppure 2 per rifiutarla.",
  en: "This is AgentCaller’s automated assistant. The business is on the line. Press 1 to accept, or 2 to decline.",
};
