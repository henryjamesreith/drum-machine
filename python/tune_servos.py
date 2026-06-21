#!/usr/bin/env python3
"""Interactive servo tuning console for the robot drummer."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from manual_keyboard import (
    DEFAULT_CONFIG_PATH,
    configure_servos,
    load_config,
    open_serial,
    parse_servos,
    send_command,
)


HELP_TEXT = """Commands:
  hit <servo>
  rest <servo>
  allrest
  set <servo> <return_angle> <strike_angle> <dwell_ms> <step_delay_ms>
  status
  status <servo>
  help
  quit

Example:
  set 0 90 60 80 0
  hit 0
"""


def print_responses(responses: list[str]) -> None:
    for response in responses:
        print(response)


def normalize_command(raw_command: str) -> str:
    parts = raw_command.strip().split()
    if not parts:
        return ""

    command = parts[0].lower()
    args = parts[1:]

    if command == "hit" and len(args) == 1:
        return f"HIT {args[0]}"
    if command == "rest" and len(args) == 1:
        return f"REST {args[0]}"
    if command == "allrest" and len(args) == 0:
        return "ALLREST"
    if command == "set" and len(args) == 5:
        return "SET " + " ".join(args)
    if command == "status" and len(args) <= 1:
        return "STATUS" if not args else f"STATUS {args[0]}"

    return raw_command.strip().upper()


def run_tuner(port: str | None, config_path: Path) -> int:
    config = load_config(config_path)
    servos = parse_servos(config)
    command_timeout = float(config.get("serial", {}).get("command_timeout_seconds", 2.0))

    try:
        connection = open_serial(config, port)
    except Exception as exc:
        print(f"Could not open serial connection: {exc}", file=sys.stderr)
        return 1

    print(f"Connected to {connection.port} at {connection.baudrate} baud.")

    try:
        print_responses(send_command(connection, "PING", timeout_seconds=command_timeout))
        print("Loading settings from config/servos.json...")
        configure_servos(connection, servos, command_timeout)
        print()
        print(HELP_TEXT)

        while True:
            raw_command = input("servo> ").strip()
            if raw_command.lower() in {"q", "quit", "exit"}:
                return 0
            if raw_command.lower() in {"h", "help", "?"}:
                print(HELP_TEXT)
                continue

            command = normalize_command(raw_command)
            if not command:
                continue

            print_responses(send_command(connection, command, timeout_seconds=command_timeout))
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Interactively tune robot drummer servo settings.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH, help="Path to servos.json")
    parser.add_argument("--port", help="Serial port override, for example /dev/cu.usbmodem1101")
    args = parser.parse_args()

    return run_tuner(args.port, args.config)


if __name__ == "__main__":
    raise SystemExit(main())
