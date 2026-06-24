import { openai } from "@ai-sdk/openai";
import { streamText, tool } from "ai";
import { z } from "zod";

import { startGeneratedBeat } from "@/lib/drum-machine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(
      '3:"Missing OPENAI_API_KEY. Add it to web/.env.local and restart npm run dev."\n',
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Vercel-AI-Data-Stream": "v1",
        },
      },
    );
  }

  try {
    const { messages } = await request.json();

    const result = await streamText({
      model: openai(process.env.OPENAI_MODEL ?? "gpt-4o-mini"),
      maxRetries: 0,
      maxSteps: 2,
      system: [
        "You control a five-servo robot drum kit. Only channels 0 through 4 exist.",
        "Drum map: channel 0 is a cymbal; channel 1 is a small tom; channel 2 is a big tom that must serve the musical role of the kick drum; channel 3 is a small tom that must serve the musical role of the snare drum; channel 4 is the hi-hat.",
        "Construct conventional grooves by using channel 2 for kick patterns, channel 3 for snare backbeats and ghost notes, channel 4 for timekeeping, channel 0 for crashes or accents, and channel 1 for tom fills.",
        "Never output channel 5 or any channel outside 0 through 4.",
        "When the user asks for a beat or rhythm, create a short playable pattern and call generateAndPlayBeat.",
        "Use integer millisecond timestamps. Keep patterns between 1 and 8 seconds with at most 64 hits.",
        "Choose a tempo multiplier from 0.5 to 2 and a loop count from 1 to 16 based on the request. Use tempo 1 and loops 4 when the user does not specify.",
        "After the tool succeeds, briefly describe what is playing. Do not include raw JSON.",
      ].join("\n"),
      messages,
      tools: {
        generateAndPlayBeat: tool({
          description:
            "Generate a drum pattern and immediately play it on the local robot drum kit.",
          parameters: z.object({
            name: z.string().min(1).max(80),
            lengthMs: z.number().int().min(1000).max(8000),
            tempo: z
              .number()
              .min(0.5)
              .max(2)
              .describe("Playback speed multiplier. 1 is the pattern's original speed."),
            loops: z
              .number()
              .int()
              .min(1)
              .max(16)
              .describe("Number of times to repeat the generated pattern."),
            events: z
              .array(
                z.object({
                  timeMs: z.number().int().min(0).max(7999),
                  servo: z
                    .number()
                    .int()
                    .min(0)
                    .max(4)
                    .describe(
                      "0 cymbal, 1 small tom, 2 big tom used as kick, 3 small tom used as snare, 4 hi-hat",
                    ),
                }),
              )
              .min(1)
              .max(64),
          }),
          execute: async (input) => {
            const startedAt = Date.now();
            const result = await startGeneratedBeat(input);
            return {
              ...result,
              durationMs: Date.now() - startedAt,
            };
          },
        }),
      },
    });

    return result.toDataStreamResponse({
      getErrorMessage: (error) =>
        error instanceof Error ? error.message : "Chat request failed.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat request failed.";
    return new Response(`3:${JSON.stringify(message)}\n`, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Vercel-AI-Data-Stream": "v1",
      },
    });
  }
}
