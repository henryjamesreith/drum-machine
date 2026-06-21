#!/usr/bin/env python3
"""Play timestamped JSON drum patterns through the Arduino firmware."""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from manual_keyboard import (
    DEFAULT_CONFIG_PATH,
    configure_servos,
    load_config,
    open_serial,
    parse_servos,
    send_command,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PATTERN_PATH = PROJECT_ROOT / "patterns" / "simple_beat.json"


@dataclass(frozen=True)
class PatternEvent:
    time_ms: int
    servo: int


@dataclass(frozen=True)
class Pattern:
    name: str
    length_ms: int
    events: list[PatternEvent]


def load_pattern(path: Path, beat_name: str | None = None) -> Pattern:
    with path.open("r", encoding="utf-8") as pattern_file:
        data: Any = json.load(pattern_file)

    if isinstance(data, dict) and "beats" in data:
        beats = data["beats"]
        if not isinstance(beats, dict) or not beats:
            raise ValueError("beats must be a non-empty object")

        selected_name = beat_name or data.get("default") or next(iter(beats))
        if selected_name not in beats:
            available = ", ".join(beats)
            raise ValueError(f'Unknown beat "{selected_name}". Available beats: {available}')

        data = beats[selected_name]
        if not isinstance(data, dict):
            raise ValueError(f'Beat "{selected_name}" must be an object')
        data = {**data, "name": data.get("name", selected_name)}
    elif beat_name is not None:
        raise ValueError("--beat can only be used with a pattern file containing a beats object")

    if isinstance(data, list):
        name = path.stem
        raw_events = data
        declared_length = None
    elif isinstance(data, dict):
        name = str(data.get("name", path.stem))
        raw_events = data.get("events")
        declared_length = data.get("length_ms")
    else:
        raise ValueError("Pattern must be a JSON object or an array of events")

    if not isinstance(raw_events, list) or not raw_events:
        raise ValueError("Pattern must contain a non-empty events array")

    events = []
    for index, raw_event in enumerate(raw_events):
        if not isinstance(raw_event, dict):
            raise ValueError(f"Event {index} must be an object")

        event_time = raw_event.get("time_ms", raw_event.get("time"))
        servo = raw_event.get("servo")
        if isinstance(event_time, bool) or not isinstance(event_time, int) or event_time < 0:
            raise ValueError(f"Event {index} needs a non-negative integer time_ms")
        if isinstance(servo, bool) or not isinstance(servo, int) or servo < 0:
            raise ValueError(f"Event {index} needs a non-negative integer servo")
        events.append(PatternEvent(time_ms=event_time, servo=servo))

    events.sort(key=lambda event: event.time_ms)
    minimum_length = events[-1].time_ms + 1
    length_ms = minimum_length if declared_length is None else declared_length
    if isinstance(length_ms, bool) or not isinstance(length_ms, int) or length_ms < minimum_length:
        raise ValueError(f"length_ms must be an integer of at least {minimum_length}")

    return Pattern(name=name, length_ms=length_ms, events=events)


def list_beats(path: Path) -> tuple[str | None, list[str]]:
    with path.open("r", encoding="utf-8") as pattern_file:
        data: Any = json.load(pattern_file)

    if not isinstance(data, dict) or not isinstance(data.get("beats"), dict):
        raise ValueError("Pattern file does not contain a beats object")
    if not data["beats"]:
        raise ValueError("beats must not be empty")

    default = data.get("default")
    return (str(default) if default is not None else None, list(data["beats"]))


def validate_channels(pattern: Pattern, configured_channels: set[int]) -> None:
    unknown = sorted({event.servo for event in pattern.events} - configured_channels)
    if unknown:
        channels = ", ".join(str(channel) for channel in unknown)
        raise ValueError(f"Pattern uses servo channels not found in config: {channels}")


def build_schedule(pattern: Pattern, repeat: int, tempo: float) -> list[tuple[float, list[int]]]:
    events_by_time: dict[float, list[int]] = {}
    for repetition in range(repeat):
        offset_ms = repetition * pattern.length_ms
        for event in pattern.events:
            event_time = (offset_ms + event.time_ms) / (1000.0 * tempo)
            events_by_time.setdefault(event_time, []).append(event.servo)
    return sorted(events_by_time.items())


def print_schedule(pattern: Pattern, schedule: list[tuple[float, list[int]]], names: dict[int, str]) -> None:
    hit_count = sum(len(channels) for _, channels in schedule)
    print(f'Pattern: "{pattern.name}" ({hit_count} hits)')
    for event_time, channels in schedule:
        hit_names = ", ".join(f"{channel} ({names[channel]})" for channel in channels)
        command = "HIT" if len(channels) == 1 else "HITM"
        print(f"{event_time:7.3f}s  {command} {hit_names}")


def drain_responses(connection: Any) -> None:
    while connection.in_waiting:
        response = connection.readline().decode("utf-8", errors="replace").strip()
        if response:
            print(response)


def play_schedule(connection: Any, schedule: list[tuple[float, list[int]]]) -> None:
    started_at = time.monotonic()
    for event_time, channels in schedule:
        while True:
            remaining = started_at + event_time - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(remaining, 0.002))

        if len(channels) == 1:
            command = f"HIT {channels[0]}"
        else:
            command = "HITM " + " ".join(str(channel) for channel in channels)
        send_command(connection, command, read_response=False)
        print(f"{event_time:7.3f}s  {command}")
        drain_responses(connection)


def main() -> int:
    parser = argparse.ArgumentParser(description="Play a timestamped JSON drum pattern.")
    parser.add_argument("pattern", nargs="?", type=Path, default=DEFAULT_PATTERN_PATH)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH, help="Path to servos.json")
    parser.add_argument("--port", help="Serial port override, for example /dev/cu.usbmodem1101")
    parser.add_argument("--beat", help="Beat name from a multi-beat JSON file")
    parser.add_argument("--list-beats", action="store_true", help="List available beats and exit")
    parser.add_argument("--repeat", type=int, default=1, help="Number of times to play the pattern")
    parser.add_argument("--tempo", type=float, default=1.0, help="Playback speed multiplier")
    parser.add_argument("--dry-run", action="store_true", help="Print the schedule without moving servos")
    args = parser.parse_args()

    if args.repeat < 1:
        parser.error("--repeat must be at least 1")
    if args.tempo <= 0:
        parser.error("--tempo must be greater than 0")

    if args.list_beats:
        try:
            default_beat, beat_names = list_beats(args.pattern)
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
            print(f"Could not load pattern: {exc}", file=sys.stderr)
            return 1

        for beat_name in beat_names:
            suffix = " (default)" if beat_name == default_beat else ""
            print(f"{beat_name}{suffix}")
        return 0

    try:
        config = load_config(args.config)
        servos = parse_servos(config)
        pattern = load_pattern(args.pattern, args.beat)
        validate_channels(pattern, {servo.channel for servo in servos})
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        print(f"Could not load pattern: {exc}", file=sys.stderr)
        return 1

    schedule = build_schedule(pattern, args.repeat, args.tempo)
    names = {servo.channel: servo.name for servo in servos}
    if args.dry_run:
        print_schedule(pattern, schedule, names)
        return 0

    command_timeout = float(config.get("serial", {}).get("command_timeout_seconds", 2.0))
    try:
        connection = open_serial(config, args.port)
    except Exception as exc:
        print(f"Could not open serial connection: {exc}", file=sys.stderr)
        return 1

    print(f"Connected to {connection.port} at {connection.baudrate} baud.")
    try:
        for response in send_command(connection, "PING", timeout_seconds=command_timeout):
            print(response)
        configure_servos(connection, servos, command_timeout)
        print(f'Playing "{pattern.name}". Press Ctrl+C to stop.\n')
        play_schedule(connection, schedule)
        time.sleep(max(servo.dwell_ms for servo in servos) / 1000.0 + 0.1)
        drain_responses(connection)
    except KeyboardInterrupt:
        print("\nPlayback stopped.")
    finally:
        for response in send_command(connection, "ALLREST", timeout_seconds=command_timeout):
            print(response)
        connection.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
