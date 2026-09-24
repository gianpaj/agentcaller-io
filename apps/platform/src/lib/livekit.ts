import { AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import type { CreateCallInput } from "@agentcaller/contracts";
import { getLiveKitEnv } from "./env";

let dispatchClient: AgentDispatchClient | undefined;
let roomClient: RoomServiceClient | undefined;

function credentials() {
  const env = getLiveKitEnv();
  return [
    env.LIVEKIT_URL,
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET,
  ] as const;
}

export function roomNameForCall(callId: string) {
  return `call_${callId}`;
}

export async function dispatchCall(callId: string, input: CreateCallInput) {
  const env = getLiveKitEnv();
  const region = input.destinationCountry === "ES" ? "eu" : "us";
  const agentName =
    region === "eu" ? env.LIVEKIT_AGENT_EU : env.LIVEKIT_AGENT_US;
  const roomName = roomNameForCall(callId);
  if (!dispatchClient)
    dispatchClient = new AgentDispatchClient(...credentials());
  await dispatchClient.createDispatch(roomName, agentName, {
    metadata: JSON.stringify({ callId, input, region }),
  });
  return roomName;
}

/**
 * Tears down the room, which drops the SIP participant and ends the PSTN leg. Callers treat a
 * failure as non-fatal: the call row is already terminal and the room's maxCallDuration caps
 * any leg we fail to close here.
 */
export async function stopCall(roomName: string) {
  if (!roomClient) roomClient = new RoomServiceClient(...credentials());
  await roomClient.deleteRoom(roomName);
}

export async function dispatchConnectAttempt(
  callId: string,
  attemptId: string,
  room: string,
) {
  const { authorizeOperatorCall } = await import("./operator-funding");
  await authorizeOperatorCall(callId);
  if (!dispatchClient)
    dispatchClient = new AgentDispatchClient(...credentials());
  await dispatchClient.createDispatch(room, getLiveKitEnv().LIVEKIT_AGENT_EU, {
    metadata: JSON.stringify({ kind: "connect_me", callId, attemptId }),
  });
}
