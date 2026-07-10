import { cli, defineAgent, inference, voice, WorkerOptions } from "@livekit/agents";
import { createCallSchema } from "@agentcaller/contracts";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const dispatchSchema = z.object({ callId: z.string().uuid(), input: createCallSchema, region: z.enum(["eu", "us"]) });

function instructions(input: z.infer<typeof createCallSchema>) {
  const language = input.language === "es" ? "Spanish" : "English";
  return `You are AgentCaller, an automated phone assistant. Speak ${language}. Start by stating that you are an automated assistant and the purpose of this call. Ask whether the recipient consents to recording. If consent is not granted, continue without claiming to record. Complete only this task: ${JSON.stringify(input.task)}. Never purchase anything, request card data, discuss regulated matters, call emergency services, or retry a failed call. Stop when the task is complete, refused, impossible, or needs clarification. Give a short structured verbal recap before ending.`;
}

export default defineAgent({
  entry: async (ctx) => {
    const metadata = dispatchSchema.parse(JSON.parse(ctx.job.metadata));
    await ctx.connect();
    const agent = new voice.Agent({ instructions: instructions(metadata.input) });
    const session = new voice.AgentSession({
      stt: new inference.STT({ model: "xai/stt-1", language: metadata.input.language }),
      llm: new inference.LLM({ model: "xai/grok-4-1-fast-non-reasoning", modelOptions: { temperature: 0.2, max_completion_tokens: 700 } }),
      tts: new inference.TTS({ model: "xai/tts-1", voice: metadata.input.voiceId ?? "ara", language: metadata.input.language }),
    });
    await session.start({ agent, room: ctx.room });
    await session.generateReply({ instructions: "Begin the call now with the required disclosure and purpose." });
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
