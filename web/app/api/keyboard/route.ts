import { NextResponse } from "next/server";

import {
  sendKeyboardKey,
  startKeyboardControl,
  stopKeyboardControl,
} from "@/lib/drum-machine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "start" | "key" | "stop";
      key?: string;
    };

    if (body.action === "start") {
      return NextResponse.json(await startKeyboardControl());
    }
    if (body.action === "stop") {
      return NextResponse.json(stopKeyboardControl());
    }
    if (body.action === "key" && body.key) {
      return NextResponse.json(await sendKeyboardKey(body.key));
    }

    return NextResponse.json(
      { error: "Expected action=start, action=key with a key, or action=stop." },
      { status: 400 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Keyboard control failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
