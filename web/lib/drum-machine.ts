import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { readFile, unlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";

export type BeatSummary = {
  key: string;
  name: string;
  lengthMs: number;
};

export type PatternEvent = {
  time_ms?: number;
  time?: number;
  servo?: number;
};

type PatternBeat = {
  name?: string;
  length_ms?: number;
  events?: PatternEvent[];
};

type PatternLibrary = {
  default?: string;
  beats?: Record<string, PatternBeat>;
};

type PlaybackState = {
  child: ChildProcessWithoutNullStreams | null;
  beat: string | null;
  temporaryPattern: string | null;
};

type KeyboardControl = {
  key: string;
  channel: number | null;
  name: string;
};

type KeyboardState = {
  child: ChildProcessWithoutNullStreams | null;
  connected: boolean;
  output: string[];
};

declare global {
  // eslint-disable-next-line no-var
  var drumPlayback: PlaybackState | undefined;
  // eslint-disable-next-line no-var
  var drumKeyboard: KeyboardState | undefined;
}

export const repoRoot = path.resolve(process.cwd(), "..");
export const patternPath = path.join(repoRoot, "patterns", "simple_beat.json");
export const servoConfigPath = path.join(repoRoot, "config", "servos.json");

function getPlaybackState(): PlaybackState {
  if (!globalThis.drumPlayback) {
    globalThis.drumPlayback = {
      child: null,
      beat: null,
      temporaryPattern: null,
    };
  }

  return globalThis.drumPlayback;
}

function getKeyboardState(): KeyboardState {
  if (!globalThis.drumKeyboard) {
    globalThis.drumKeyboard = {
      child: null,
      connected: false,
      output: [],
    };
  }

  return globalThis.drumKeyboard;
}

function normalizeEvent(event: PatternEvent): { timeMs: number; servo: number } | null {
  const timeMs = event.time_ms ?? event.time;
  const servo = event.servo;

  if (
    typeof timeMs !== "number" ||
    typeof servo !== "number" ||
    !Number.isInteger(timeMs) ||
    !Number.isInteger(servo) ||
    timeMs < 0 ||
    servo < 0
  ) {
    return null;
  }

  return { timeMs, servo };
}

export async function readBeatSummaries(): Promise<{
  defaultBeat: string | null;
  beats: BeatSummary[];
}> {
  const raw = await readFile(patternPath, "utf-8");
  const library = JSON.parse(raw) as PatternLibrary;
  const beats = library.beats ?? {};

  const summaries = Object.entries(beats).map(([key, beat]) => {
    const events = (beat.events ?? []).map(normalizeEvent).filter(Boolean) as {
      timeMs: number;
      servo: number;
    }[];
    const times = events.map((event) => event.timeMs);

    return {
      key,
      name: beat.name ?? key.replace(/_/g, " "),
      lengthMs: beat.length_ms ?? (times.length ? Math.max(...times) + 1 : 0),
    };
  });

  return {
    defaultBeat: library.default ?? null,
    beats: summaries,
  };
}

export async function readKeyboardControls(): Promise<KeyboardControl[]> {
  const raw = await readFile(servoConfigPath, "utf-8");
  const config = JSON.parse(raw) as {
    keys?: { all_rest?: string; status?: string; quit?: string };
    servos?: Record<string, { key?: string; name?: string }>;
  };
  const controls: KeyboardControl[] = Object.entries(config.servos ?? {})
    .map(([channel, servo]) => ({
      key: (servo.key ?? "").toUpperCase(),
      channel: Number(channel),
      name: servo.name ?? `servo_${channel}`,
    }))
    .filter((control) => control.key);

  controls.push(
    {
      key: (config.keys?.all_rest ?? "r").toUpperCase(),
      channel: null,
      name: "all rest",
    },
    {
      key: config.keys?.status ?? "?",
      channel: null,
      name: "status",
    },
    {
      key: (config.keys?.quit ?? "q").toUpperCase(),
      channel: null,
      name: "quit",
    },
  );

  return controls;
}

export async function assertBeatExists(beatKey: string) {
  const { beats } = await readBeatSummaries();
  if (!beats.some((beat) => beat.key === beatKey)) {
    throw new Error(`Unknown beat: ${beatKey}`);
  }
}

export function getPythonExecutable() {
  const venvPython = path.join(repoRoot, ".venv", "bin", "python");
  return existsSync(venvPython) ? venvPython : "python3";
}

function validatePlaybackOptions(tempo: number, loops: number) {
  if (!Number.isFinite(tempo) || tempo < 0.5 || tempo > 2) {
    throw new Error("Tempo must be between 0.5x and 2x.");
  }
  if (!Number.isInteger(loops) || loops < 1 || loops > 16) {
    throw new Error("Loops must be a whole number from 1 to 16.");
  }
}

async function startPlayer({
  label,
  args,
  temporaryPattern = null,
}: {
  label: string;
  args: string[];
  temporaryPattern?: string | null;
}) {
  if (process.env.VERCEL) {
    throw new Error("Playback is local-only because it needs USB serial access.");
  }

  const state = getPlaybackState();
  if (state.child && !state.child.killed) {
    throw new Error(`Playback already running: ${state.beat}`);
  }
  const keyboardState = getKeyboardState();
  if (keyboardState.child && !keyboardState.child.killed) {
    throw new Error("Turn off keyboard control before starting playback.");
  }

  const python = getPythonExecutable();
  const child = spawn(
    python,
    ["python/play_pattern.py", ...args],
    {
      cwd: repoRoot,
      env: process.env,
    },
  );

  state.child = child;
  state.beat = label;
  state.temporaryPattern = temporaryPattern;

  const clearPlayback = async () => {
    if (temporaryPattern) {
      await unlink(temporaryPattern).catch(() => undefined);
    }
    if (state.child === child) {
      state.child = null;
      state.beat = null;
      state.temporaryPattern = null;
    }
  };

  child.once("error", clearPlayback);
  child.once("close", clearPlayback);

  return { playing: label };
}

export async function startSavedBeat({
  beat,
  tempo,
  loops,
}: {
  beat: string;
  tempo: number;
  loops: number;
}) {
  validatePlaybackOptions(tempo, loops);
  await assertBeatExists(beat);
  return startPlayer({
    label: beat,
    args: [
      "--beat",
      beat,
      "--tempo",
      String(tempo),
      "--repeat",
      String(loops),
    ],
  });
}

export async function startGeneratedBeat({
  name,
  lengthMs,
  events,
  tempo,
  loops,
}: {
  name: string;
  lengthMs: number;
  events: Array<{ timeMs: number; servo: number }>;
  tempo: number;
  loops: number;
}) {
  validatePlaybackOptions(tempo, loops);
  if (!events.length) {
    throw new Error("Generated beat must contain at least one hit.");
  }

  const configuredChannels = new Set(
    (await readKeyboardControls())
      .map((control) => control.channel)
      .filter((channel): channel is number => channel !== null),
  );
  const sortedEvents = [...events].sort((a, b) => a.timeMs - b.timeMs);
  const invalidEvent = sortedEvents.find(
    ({ timeMs, servo }) =>
      !Number.isInteger(timeMs) ||
      timeMs < 0 ||
      timeMs >= 8000 ||
      !Number.isInteger(servo) ||
      !configuredChannels.has(servo),
  );
  if (invalidEvent) {
    throw new Error("Generated beat contains an invalid time or servo channel.");
  }

  const minimumLength = sortedEvents[sortedEvents.length - 1].timeMs + 1;
  const normalizedLength = Math.max(lengthMs, minimumLength);
  if (!Number.isInteger(normalizedLength) || normalizedLength > 8000) {
    throw new Error("Generated beat must be no longer than 8 seconds.");
  }

  const temporaryPattern = path.join(
    os.tmpdir(),
    `drum-machine-${randomUUID()}.json`,
  );
  await writeFile(
    temporaryPattern,
    JSON.stringify({
      name,
      length_ms: normalizedLength,
      events: sortedEvents.map(({ timeMs, servo }) => ({
        time_ms: timeMs,
        servo,
      })),
    }),
    "utf-8",
  );

  try {
    const result = await startPlayer({
      label: name,
      args: [
        temporaryPattern,
        "--tempo",
        String(tempo),
        "--repeat",
        String(loops),
      ],
      temporaryPattern,
    });
    return { ...result, tempo, loops };
  } catch (error) {
    await unlink(temporaryPattern).catch(() => undefined);
    throw error;
  }
}

export function stopPlayback() {
  const state = getPlaybackState();
  if (state.child && !state.child.killed) {
    state.child.kill("SIGINT");
  }

  return { stopped: true };
}

export async function startKeyboardControl() {
  if (process.env.VERCEL) {
    throw new Error("Keyboard control is local-only because it needs USB serial access.");
  }

  const playbackState = getPlaybackState();
  if (playbackState.child && !playbackState.child.killed) {
    throw new Error("Stop playback before turning on keyboard control.");
  }

  const state = getKeyboardState();
  if (state.child && !state.child.killed) {
    return {
      connected: state.connected,
      output: state.output.slice(-30),
      controls: await readKeyboardControls(),
    };
  }

  const child = spawn(
    getPythonExecutable(),
    ["-u", "python/web_keyboard.py"],
    {
      cwd: repoRoot,
      env: process.env,
    },
  );
  state.child = child;
  state.connected = false;
  state.output = [];

  const appendOutput = (chunk: Buffer) => {
    const lines = chunk
      .toString("utf-8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    state.output.push(...lines.filter((line) => line !== "WEB_KEYBOARD_READY"));
    state.output = state.output.slice(-100);
  };

  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  child.once("close", () => {
    if (state.child === child) {
      state.child = null;
      state.connected = false;
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(state.output.at(-1) ?? "Keyboard connection timed out."));
    }, 10000);

    const onData = (chunk: Buffer) => {
      if (chunk.toString("utf-8").includes("WEB_KEYBOARD_READY")) {
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        state.connected = true;
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("close", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(
          state.output.at(-1) ?? `Keyboard controller exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
  }).catch((error) => {
    child.kill("SIGINT");
    throw error;
  });

  return {
    connected: true,
    output: state.output.slice(-30),
    controls: await readKeyboardControls(),
  };
}

export async function sendKeyboardKey(key: string) {
  const normalizedKey = key.toLowerCase();
  const controls = await readKeyboardControls();
  const allowedKeys = new Set(controls.map((control) => control.key.toLowerCase()));
  if (!allowedKeys.has(normalizedKey)) {
    throw new Error(`Unsupported keyboard key: ${key}`);
  }

  const state = getKeyboardState();
  if (!state.child || state.child.killed || !state.connected) {
    throw new Error("Keyboard control is not connected.");
  }

  if (normalizedKey === "q") {
    state.child.stdin.write("q\n");
    state.connected = false;
  } else {
    state.child.stdin.write(`${normalizedKey}\n`);
  }

  return { connected: state.connected, key: normalizedKey.toUpperCase() };
}

export function stopKeyboardControl() {
  const state = getKeyboardState();
  if (state.child && !state.child.killed) {
    state.child.stdin.write("q\n");
  }
  state.connected = false;
  return { connected: false };
}
