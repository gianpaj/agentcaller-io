import { AgentDispatchClient, SipClient } from "livekit-server-sdk";
import type { CreateCallInput } from "@agentcaller/contracts";
import { getServerEnv } from "./env";

export async function dispatchCall(callId: string, input: CreateCallInput) {
  const env = getServerEnv();
  const region = input.destinationCountry === "ES" ? "eu" : "us";
  const agentName = region === "eu" ? env.LIVEKIT_AGENT_EU : env.LIVEKIT_AGENT_US;
  const trunkId = region === "eu" ? env.LIVEKIT_SIP_TRUNK_EU : env.LIVEKIT_SIP_TRUNK_US;
  const callerId = region === "eu" ? env.LIVEKIT_CALLER_ID_EU : env.LIVEKIT_CALLER_ID_US;
  const roomName = `call_${callId}`;
  const client = new AgentDispatchClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  await client.createDispatch(roomName, agentName, { metadata: JSON.stringify({ callId, input, region }) });
  const sipClient = new SipClient(env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  await sipClient.createSipParticipant(trunkId, input.destination, roomName, {
    participantIdentity: `business_${callId}`,
    participantName: "Business",
    fromNumber: callerId,
    maxCallDuration: input.maxDurationSeconds,
    waitUntilAnswered: false,
  });
  return roomName;
}
