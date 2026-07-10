import { AgentDispatchClient, RoomServiceClient, SipClient } from "livekit-server-sdk";
import type { CreateCallInput } from "@agentcaller/contracts";
import { getServerEnv } from "./env";

let dispatchClient: AgentDispatchClient | undefined;
let sipClient: SipClient | undefined;
let roomClient: RoomServiceClient | undefined;

function credentials() {
  const env = getServerEnv();
  return [env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET] as const;
}

export function roomNameForCall(callId: string) {
  return `call_${callId}`;
}

export async function dispatchCall(callId: string, input: CreateCallInput) {
  const env = getServerEnv();
  const region = input.destinationCountry === "ES" ? "eu" : "us";
  const agentName = region === "eu" ? env.LIVEKIT_AGENT_EU : env.LIVEKIT_AGENT_US;
  const trunkId = region === "eu" ? env.LIVEKIT_SIP_TRUNK_EU : env.LIVEKIT_SIP_TRUNK_US;
  const callerId = region === "eu" ? env.LIVEKIT_CALLER_ID_EU : env.LIVEKIT_CALLER_ID_US;
  const roomName = roomNameForCall(callId);
  if (!dispatchClient) dispatchClient = new AgentDispatchClient(...credentials());
  await dispatchClient.createDispatch(roomName, agentName, { metadata: JSON.stringify({ callId, input, region }) });
  if (!sipClient) sipClient = new SipClient(...credentials());
  await sipClient.createSipParticipant(trunkId, input.destination, roomName, {
    participantIdentity: `business_${callId}`,
    participantName: "Business",
    fromNumber: callerId,
    maxCallDuration: input.maxDurationSeconds,
    waitUntilAnswered: false,
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
