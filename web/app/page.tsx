"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useChat } from "ai/react";
import {
  ChevronDown,
  Keyboard,
  Loader2,
  Minus,
  Play,
  Plus,
  Search,
  Send,
  Square,
} from "lucide-react";

type Beat = {
  key: string;
  name: string;
  lengthMs: number;
};

type BeatResponse = {
  defaultBeat: string | null;
  beats: Beat[];
};

type KeyboardControl = {
  key: string;
  channel: number | null;
  name: string;
};

const defaultKeyboardControls: KeyboardControl[] = [
  { key: "A", channel: 0, name: "cymbal" },
  { key: "S", channel: 1, name: "small tom" },
  { key: "D", channel: 2, name: "big tom / kick" },
  { key: "F", channel: 3, name: "small tom / snare" },
  { key: "G", channel: 4, name: "hi-hat" },
  { key: "R", channel: null, name: "all rest" },
  { key: "?", channel: null, name: "status" },
  { key: "Q", channel: null, name: "quit" },
];

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${Math.max(durationMs, 1)}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

export default function Home() {
  const [beats, setBeats] = useState<Beat[]>([]);
  const [selectedBeat, setSelectedBeat] = useState("");
  const [notice, setNotice] = useState("");
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [beatPickerOpen, setBeatPickerOpen] = useState(false);
  const [beatSearch, setBeatSearch] = useState("");
  const [keyboardState, setKeyboardState] = useState<
    "off" | "connecting" | "active"
  >("off");
  const [keyboardControls, setKeyboardControls] = useState(defaultKeyboardControls);
  const [lastKey, setLastKey] = useState("");
  const [tempo, setTempo] = useState(1);
  const [loops, setLoops] = useState(1);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
  } = useChat({
    api: "/api/chat",
    onError: (error) => setNotice(error.message || "Chat request failed."),
  });

  useEffect(() => {
    fetch("/api/beats", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as BeatResponse & { error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Could not load beats.");
        }
        setBeats(data.beats);
        setSelectedBeat(data.defaultBeat || data.beats[0]?.key || "");
      })
      .catch((error: Error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    if (!isLoading || requestStartedAt === null) {
      return;
    }

    const updateElapsed = () => setElapsedMs(Date.now() - requestStartedAt);
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(interval);
  }, [isLoading, requestStartedAt]);

  const latestRequestHasToolResult = useMemo(() => {
    const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
    return messages.slice(lastUserIndex + 1).some((message) =>
      (message.parts ?? []).some(
        (part) =>
          part.type === "tool-invocation" &&
          part.toolInvocation.toolName === "generateAndPlayBeat" &&
          part.toolInvocation.state === "result",
      ),
    );
  }, [messages]);

  const selectedBeatName =
    beats.find((beat) => beat.key === selectedBeat)?.name ?? "Choose a saved beat";
  const filteredBeats = beats.filter((beat) =>
    beat.name.toLowerCase().includes(beatSearch.toLowerCase()),
  );

  const playbackRequest = async (body: {
    action: "play" | "stop";
    beat?: string;
    tempo?: number;
    loops?: number;
  }) => {
    setNotice("");
    const response = await fetch("/api/playback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setNotice(data.error || "Playback failed.");
    }
  };

  const submitChat = (event: FormEvent<HTMLFormElement>) => {
    setNotice("");
    setRequestStartedAt(Date.now());
    setElapsedMs(0);
    handleSubmit(event);
  };

  const keyboardRequest = async (
    body: { action: "start" | "key" | "stop"; key?: string },
  ) => {
    const response = await fetch("/api/keyboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as {
      connected?: boolean;
      controls?: KeyboardControl[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error || "Keyboard control failed.");
    }
    return data;
  };

  const toggleKeyboard = async () => {
    setNotice("");
    if (keyboardState === "active") {
      await keyboardRequest({ action: "stop" });
      setKeyboardState("off");
      return;
    }

    setKeyboardState("connecting");
    try {
      const data = await keyboardRequest({ action: "start" });
      if (data.controls) {
        setKeyboardControls(data.controls);
      }
      setKeyboardState("active");
    } catch (error) {
      setKeyboardState("off");
      setNotice(error instanceof Error ? error.message : "Keyboard control failed.");
    }
  };

  useEffect(() => {
    if (keyboardState !== "active") {
      return;
    }

    const allowedKeys = new Set(
      keyboardControls.map((control) => control.key.toLowerCase()),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (!allowedKeys.has(key)) {
        return;
      }

      event.preventDefault();
      setLastKey(key.toUpperCase());
      window.setTimeout(() => setLastKey(""), 140);
      keyboardRequest({ action: "key", key }).catch((error) => {
        setNotice(error instanceof Error ? error.message : "Keyboard command failed.");
        setKeyboardState("off");
      });
      if (key === "q") {
        setKeyboardState("off");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardControls, keyboardState]);

  const hasMessages = messages.length > 0;

  return (
    <main className="min-h-screen overflow-hidden bg-[#151716] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_right,rgba(180,255,190,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:72px_72px] opacity-25" />
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-[64px] border-r border-[#7cff6b]/10 bg-[#101211]/95 md:flex md:justify-center md:py-5">
        <div className="grid h-8 w-8 grid-cols-2 gap-1 rounded-md border border-[#7cff6b]/25 bg-[#191c1a] p-1.5">
          <span className="rounded-full bg-zinc-200" />
          <span className="rounded-full bg-[#7cff6b]" />
          <span className="rounded-full bg-zinc-600" />
          <span className="rounded-full bg-zinc-300" />
        </div>
      </aside>

      <div className="relative flex min-h-screen flex-col px-4 md:pl-[64px]">
        <section
          className={`mx-auto flex w-full max-w-4xl flex-1 flex-col ${
            hasMessages ? "" : "justify-center"
          }`}
        >
          <div className={hasMessages ? "flex-1 pt-16" : "pb-8 text-center"}>
            {hasMessages ? (
              <div className="mx-auto w-full max-w-3xl space-y-5 pb-72">
                {messages.map((message) => {
                  if (message.role === "user") {
                    return (
                      <div key={message.id} className="flex justify-end">
                        <div className="max-w-[82%] whitespace-pre-wrap rounded-[14px] bg-[#222522] px-4 py-3 text-[15px] leading-7">
                          {message.content}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={message.id} className="max-w-[82%] space-y-3">
                      {(message.parts ?? []).map((part, index) => {
                        if (part.type === "text" && part.text) {
                          return (
                            <div
                              key={`${message.id}-text-${index}`}
                              className="whitespace-pre-wrap px-1 py-2 text-[15px] leading-7 text-zinc-100"
                            >
                              {part.text}
                            </div>
                          );
                        }

                        if (
                          part.type === "tool-invocation" &&
                          part.toolInvocation.toolName === "generateAndPlayBeat"
                        ) {
                          const invocation = part.toolInvocation;

                          if (invocation.state === "result") {
                            const result = invocation.result as {
                              playing?: string;
                              durationMs?: number;
                              tempo?: number;
                              loops?: number;
                            };
                            return (
                              <div
                                key={invocation.toolCallId}
                                className="inline-flex min-h-7 items-center rounded-md border border-white/10 bg-[#1a1c1b] px-2.5 text-xs text-zinc-400"
                              >
                                Worked for{" "}
                                {formatDuration(result.durationMs ?? 0)}
                                {result.playing ? ` · Playing ${result.playing}` : ""}
                                {result.tempo ? ` · ${result.tempo}x` : ""}
                                {result.loops ? ` · ${result.loops} loops` : ""}
                              </div>
                            );
                          }

                          return (
                            <div
                              key={invocation.toolCallId}
                              className="inline-flex min-h-7 items-center gap-2 rounded-md border border-[#7cff6b]/20 bg-[#1a1c1b] px-2.5 text-xs text-zinc-300"
                            >
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7cff6b]" />
                              Generating and starting beat...
                            </div>
                          );
                        }

                        return null;
                      })}
                    </div>
                  );
                })}
                {isLoading && !latestRequestHasToolResult ? (
                  <div className="max-w-[82%]">
                    <div className="inline-flex min-h-7 items-center gap-2 rounded-md border border-[#7cff6b]/20 bg-[#1a1c1b] px-2.5 text-xs text-zinc-300">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7cff6b]" />
                      Generating beat · {formatDuration(elapsedMs)}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <h1 className="text-2xl font-medium text-zinc-100 md:text-4xl">
                Pick a beat or describe one.
              </h1>
            )}
          </div>

          <div
            className={
              hasMessages
                ? "fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-[#151716] via-[#151716] to-transparent px-4 pb-5 pt-10 md:left-[64px]"
                : "pb-16"
            }
          >
            {notice ? (
              <div className="mx-auto mb-3 max-w-3xl rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-100">
                {notice}
              </div>
            ) : null}

            <div className="mx-auto mb-3 max-w-3xl">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setBeatPickerOpen((open) => !open)}
                    className="flex h-11 w-full items-center justify-between rounded-md border border-white/10 bg-[#1b1e1c] px-3 text-left text-sm text-zinc-200 transition hover:border-white/20"
                    aria-expanded={beatPickerOpen}
                  >
                    <span className="truncate">{selectedBeatName}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                  </button>

                  {beatPickerOpen ? (
                    <div className="absolute top-[calc(100%+8px)] z-20 w-full overflow-hidden rounded-md border border-white/10 bg-[#181a19] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
                      <div className="flex items-center gap-2 border-b border-white/8 px-3">
                        <Search className="h-4 w-4 text-zinc-500" />
                        <input
                          autoFocus
                          value={beatSearch}
                          onChange={(event) => setBeatSearch(event.target.value)}
                          placeholder="Find a saved beat"
                          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto p-1.5">
                        {filteredBeats.map((beat) => (
                          <button
                            key={beat.key}
                            type="button"
                            onClick={() => {
                              setSelectedBeat(beat.key);
                              setBeatPickerOpen(false);
                              setBeatSearch("");
                            }}
                            className={`flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-sm transition ${
                              beat.key === selectedBeat
                                ? "bg-white/8 text-white"
                                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                            }`}
                          >
                            <span>{beat.name}</span>
                            <span className="ml-4 text-xs text-zinc-600">
                              {(beat.lengthMs / 1000).toFixed(1)}s
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      playbackRequest({
                        action: "play",
                        beat: selectedBeat,
                        tempo,
                        loops,
                      })
                    }
                    disabled={!selectedBeat || keyboardState !== "off"}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-white/10 px-4 text-sm text-zinc-200 transition hover:bg-white/10 disabled:opacity-40 sm:flex-none"
                  >
                    <Play className="h-4 w-4" />
                    Play
                  </button>

                  <button
                    type="button"
                    onClick={toggleKeyboard}
                    disabled={keyboardState === "connecting"}
                    className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-md border px-4 text-sm transition sm:flex-none ${
                      keyboardState === "active"
                        ? "border-[#7cff6b]/35 bg-[#7cff6b]/8 text-[#caffc2]"
                        : "border-white/10 text-zinc-300 hover:bg-white/10"
                    }`}
                  >
                    {keyboardState === "connecting" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Keyboard className="h-4 w-4" />
                    )}
                    {keyboardState === "active"
                      ? "Keyboard controls on"
                      : "Keyboard controls"}
                  </button>

                  <button
                    type="button"
                    onClick={() => playbackRequest({ action: "stop" })}
                    disabled={keyboardState !== "off"}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/10 text-zinc-300 transition hover:bg-white/10 disabled:opacity-40"
                    title="Stop playback"
                  >
                    <Square className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="mr-1 text-zinc-600">Playback</span>
                <div className="flex h-8 items-center rounded-md border border-white/10 bg-[#171918]">
                  <button
                    type="button"
                    onClick={() =>
                      setTempo((value) => Math.max(0.5, value - 0.25))
                    }
                    disabled={tempo <= 0.5 || keyboardState !== "off"}
                    className="flex h-full w-8 items-center justify-center text-zinc-500 transition hover:text-white disabled:opacity-30"
                    title="Slower"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-12 text-center font-mono text-zinc-300">
                    {tempo.toFixed(2).replace(/0$/, "")}x
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setTempo((value) => Math.min(2, value + 0.25))
                    }
                    disabled={tempo >= 2 || keyboardState !== "off"}
                    className="flex h-full w-8 items-center justify-center text-zinc-500 transition hover:text-white disabled:opacity-30"
                    title="Faster"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex h-8 items-center rounded-md border border-white/10 bg-[#171918]">
                  <button
                    type="button"
                    onClick={() => setLoops((value) => Math.max(1, value - 1))}
                    disabled={loops <= 1 || keyboardState !== "off"}
                    className="flex h-full w-8 items-center justify-center text-zinc-500 transition hover:text-white disabled:opacity-30"
                    title="Fewer loops"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-16 text-center font-mono text-zinc-300">
                    {loops} {loops === 1 ? "loop" : "loops"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLoops((value) => Math.min(16, value + 1))}
                    disabled={loops >= 16 || keyboardState !== "off"}
                    className="flex h-full w-8 items-center justify-center text-zinc-500 transition hover:text-white disabled:opacity-30"
                    title="More loops"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {keyboardState !== "off" ? (
                <div className="mt-2 rounded-md border border-white/8 bg-[#121413] px-3 py-3">
                  <div className="mb-3 flex items-center justify-between text-xs">
                    <span className="text-zinc-500">
                      {keyboardState === "connecting"
                        ? "Connecting to the drum machine..."
                        : "Keyboard armed · keep this page focused"}
                    </span>
                    {keyboardState === "active" ? (
                      <span className="text-[#9bea90]">Connected</span>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-5">
                    {keyboardControls.map((control) => (
                      <div
                        key={control.key}
                        className="flex min-w-0 items-center gap-2 text-xs text-zinc-500"
                      >
                        <kbd
                          className={`flex h-6 min-w-6 items-center justify-center rounded border px-1 font-mono text-[11px] ${
                            lastKey === control.key
                              ? "border-[#7cff6b]/60 bg-[#7cff6b]/15 text-[#caffc2]"
                              : "border-white/12 bg-[#1c1f1d] text-zinc-300"
                          }`}
                        >
                          {control.key}
                        </kbd>
                        <span className="truncate">{control.name.replaceAll("_", " ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <form
              onSubmit={submitChat}
              className="mx-auto max-w-3xl rounded-[18px] border border-[#7cff6b]/20 bg-[#1b1e1c] px-4 py-3 shadow-[0_24px_90px_rgba(0,0,0,0.55)]"
            >
              <div className="flex items-center gap-3">
                <textarea
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={1}
                  placeholder="Describe a beat..."
                  className="max-h-36 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-6 outline-none placeholder:text-zinc-500"
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim() || keyboardState !== "off"}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#e7eee7] text-black transition hover:bg-white disabled:bg-zinc-700 disabled:text-zinc-400"
                  title="Send"
                >
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
