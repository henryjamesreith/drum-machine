#!/usr/bin/env python3
"""Terminal keyboard controller for the robot drummer Arduino firmware."""

from __future__ import annotations

import argparse
import json
import select
import sys
import termios
import time
import tty
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import serial
from serial.tools import list_ports


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config" / "servos.json"


@dataclass(frozen=True)
class ServoSettings:
    channel: int
    name: str
    key: str
    return_angle: int
    strike_angle: int
    dwell_ms: int
    step_delay_ms: int


def load_config(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as config_file:
        return json.load(config_file)


def parse_servos(config: dict[str, Any]) -> list[ServoSettings]:
    servos = []
    for channel_text, values in config["servos"].items():
        servos.append(
            ServoSettings(
                channel=int(channel_text),
                name=values.get("name", f"servo_{channel_text}"),
                key=values["key"].lower(),
                return_angle=int(values["return_angle"]),
                strike_angle=int(values["strike_angle"]),
                dwell_ms=int(values["dwell_ms"]),
                step_delay_ms=int(values.get("step_delay_ms", 4)),
            )
        )
    return sorted(servos, key=lambda servo: servo.channel)


def find_arduino_port() -> str:
    ports = list(list_ports.comports())
    candidates = []

    for port in ports:
        description = f"{port.device} {port.description} {port.manufacturer or ''}".lower()
        if any(label in description for label in ("arduino", "nano", "esp32", "usb serial", "usbmodem", "usbserial")):
            candidates.append(port.device)

    if len(candidates) == 1:
        return candidates[0]

    if candidates:
        return candidates[0]

    if ports:
        available = ", ".join(port.device for port in ports)
        raise RuntimeError(f"No obvious Arduino port found. Available ports: {available}")

    raise RuntimeError("No serial ports found. Is the Arduino connected over USB?")


def open_serial(config: dict[str, Any], port_override: str | None) -> serial.Serial:
    serial_config = config.get("serial", {})
    configured_port = port_override or serial_config.get("port", "auto")
    port = find_arduino_port() if configured_port == "auto" else configured_port
    baud_rate = int(serial_config.get("baud_rate", 115200))
    timeout = float(serial_config.get("read_timeout_seconds", 0.05))

    connection = serial.Serial(port=port, baudrate=baud_rate, timeout=timeout)
    startup_wait = float(serial_config.get("startup_wait_seconds", 2.0))
    time.sleep(startup_wait)
    connection.reset_input_buffer()
    return connection


def send_command(
    connection: serial.Serial,
    command: str,
    read_response: bool = True,
    timeout_seconds: float = 2.0,
) -> list[str]:
    connection.write(f"{command}\n".encode("utf-8"))
    connection.flush()

    if not read_response:
        return []

    responses = []
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        line = connection.readline().decode("utf-8", errors="replace").strip()
        if line:
            responses.append(line)
            if line.startswith(("OK", "ERR", "READY")):
                break
    return responses


def configure_servos(connection: serial.Serial, servos: list[ServoSettings], command_timeout: float) -> None:
    for servo in servos:
        command = (
            f"SET {servo.channel} {servo.return_angle} {servo.strike_angle} "
            f"{servo.dwell_ms} {servo.step_delay_ms}"
        )
        responses = send_command(connection, command, timeout_seconds=command_timeout)
        for response in responses:
            print(response)


class RawTerminal:
    def __enter__(self) -> "RawTerminal":
        self.fd = sys.stdin.fileno()
        self.previous_settings = termios.tcgetattr(self.fd)
        tty.setcbreak(self.fd)
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        termios.tcsetattr(self.fd, termios.TCSADRAIN, self.previous_settings)


def read_key(timeout_seconds: float = 0.05) -> str | None:
    readable, _, _ = select.select([sys.stdin], [], [], timeout_seconds)
    if not readable:
        return None
    return sys.stdin.read(1).lower()


def print_controls(servos: list[ServoSettings], keys: dict[str, str]) -> None:
    print("\nRobot Drummer Manual Keyboard")
    print("--------------------------------")
    for servo in servos:
        print(f"{servo.key.upper()} -> HIT {servo.channel} ({servo.name})")
    print(f"{keys.get('all_rest', 'r').upper()} -> all rest")
    print(f"{keys.get('status', '?')} -> status")
    print(f"{keys.get('quit', 'q').upper()} -> quit")
    print("--------------------------------")
    print("Keep this terminal focused while playing.\n")


def run_controller(
    connection: serial.Serial,
    servos: list[ServoSettings],
    keys: dict[str, str],
    command_timeout: float,
) -> None:
    key_to_servo = {servo.key: servo for servo in servos}
    quit_key = keys.get("quit", "q").lower()
    all_rest_key = keys.get("all_rest", "r").lower()
    status_key = keys.get("status", "?").lower()

    print_controls(servos, keys)

    with RawTerminal():
        while True:
            key = read_key()
            if key is None:
                continue

            if key == quit_key:
                print("\nExiting.")
                return

            if key == all_rest_key:
                print("\n> ALLREST")
                for response in send_command(connection, "ALLREST", timeout_seconds=command_timeout):
                    print(response)
                continue

            if key == status_key:
                print("\n> STATUS")
                for response in send_command(connection, "STATUS", timeout_seconds=command_timeout):
                    print(response)
                continue

            servo = key_to_servo.get(key)
            if servo is None:
                continue

            print(f"\n> HIT {servo.channel} ({servo.name})")
            for response in send_command(connection, f"HIT {servo.channel}", timeout_seconds=command_timeout):
                print(response)


def main() -> int:
    parser = argparse.ArgumentParser(description="Control robot drummer servos from the keyboard.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH, help="Path to servos.json")
    parser.add_argument("--port", help="Serial port override, for example /dev/cu.usbmodem1101")
    parser.add_argument("--list-ports", action="store_true", help="List serial ports and exit")
    args = parser.parse_args()

    if args.list_ports:
        for port in list_ports.comports():
            print(f"{port.device}\t{port.description}\t{port.manufacturer or ''}")
        return 0

    config = load_config(args.config)
    servos = parse_servos(config)
    keys = config.get("keys", {})
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
        run_controller(connection, servos, keys, command_timeout)
    finally:
        connection.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
