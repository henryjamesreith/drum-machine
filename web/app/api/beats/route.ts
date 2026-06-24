import { NextResponse } from "next/server";

import { readBeatSummaries } from "@/lib/drum-machine";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await readBeatSummaries());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
