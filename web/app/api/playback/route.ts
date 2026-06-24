import { NextResponse } from "next/server";

import {
  startSavedBeat,
  stopPlayback,
} from "@/lib/drum-machine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      beat?: string;
      tempo?: number;
      loops?: number;
    };

    if (body.action === "stop") {
      return NextResponse.json(stopPlayback());
    }

    if (body.action !== "play" || !body.beat) {
      return NextResponse.json(
        { error: "Expected action=play with a beat, or action=stop." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await startSavedBeat({
        beat: body.beat,
        tempo: body.tempo ?? 1,
        loops: body.loops ?? 1,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
