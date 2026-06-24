#!/usr/bin/env python3
"""Line-based keyboard controller used by the local web app."""

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
    print_controls,
    send_command,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Control robot drummer from line-based input.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--port")
    args = parser.parse_args()

    config = load_config(args.config)
    servos = parse_servos(config)
    keys = config.get("keys", {})
    command_timeout = float(config.get("serial", {}).get("command_timeout_seconds", 2.0))
    key_to_servo = {servo.key: servo for servo in servos}
    all_rest_key = keys.get("all_rest", "r").lower()
    status_key = keys.get("status", "?").lower()
    quit_key = keys.get("quit", "q").lower()

    try:
        connection = open_serial(config, args.port)
    except Exception as exc:
        print(f"Could not open serial connection: {exc}", file=sys.stderr, flush=True)
        return 1

    print(f"Connected to {connection.port} at {connection.baudrate} baud.", flush=True)

    try:
        for response in send_command(connection, "PING", timeout_seconds=command_timeout):
            print(response, flush=True)
        configure_servos(connection, servos, command_timeout)
        print_controls(servos, keys)
        print("WEB_KEYBOARD_READY", flush=True)

        for line in sys.stdin:
            key = line.strip().lower()
            if not key:
                continue

            if key == quit_key:
                print("Exiting.", flush=True)
                break

            if key == all_rest_key:
                command = "ALLREST"
                label = "all rest"
            elif key == status_key:
                command = "STATUS"
                label = "status"
            else:
                servo = key_to_servo.get(key)
                if servo is None:
                    continue
                command = f"HIT {servo.channel}"
                label = servo.name

            print(f"> {command} ({label})", flush=True)
            for response in send_command(connection, command, timeout_seconds=command_timeout):
                print(response, flush=True)
    finally:
        connection.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
