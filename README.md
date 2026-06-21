# Robot Drummer

Desktop robot drummer controlled by an Arduino Nano ESP32, a PCA9685 servo driver,
and a Python keyboard controller.

## Current Milestone

Manual keyboard control:

- `A` hits servo channel 0 (cymbal)
- `S` hits servo channel 1 (big tom)
- `D` hits servo channel 2 (little tom 1)
- `F` hits servo channel 3 (little tom 2)
- `G` hits servo channel 4 (high-hat)
- `H` hits servo channel 5 (snare)
- `R` returns all servos to rest
- `?` prints firmware status
- `Q` quits the Python controller

## Arduino Firmware

Open this sketch in the Arduino IDE:

```text
arduino/firmware/robot_drummer_firmware/robot_drummer_firmware.ino
```

Install/select:

- Arduino Nano ESP32 board package
- Adafruit PWM Servo Driver library

Upload the sketch to the Arduino.

The firmware listens over USB serial at `115200` baud and supports:

```text
PING
HIT <servo>
HITM <servo> <servo> [...]
REST <servo>
ALLREST
SET <servo> <return_angle> <strike_angle> <dwell_ms> <step_delay_ms>
STATUS
```

## Python Setup

From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

List available serial ports:

```bash
python python/manual_keyboard.py --list-ports
```

Run the keyboard controller:

```bash
python python/manual_keyboard.py
```

If auto-detection picks the wrong port, pass it explicitly:

```bash
python python/manual_keyboard.py --port /dev/cu.usbmodem1101
```

## Servo Tuning

Edit:

```text
config/servos.json
```

Important fields:

- `return_angle`: resting stick angle
- `strike_angle`: drum hit angle
- `dwell_ms`: how long to hold the strike before returning
- `step_delay_ms`: delay between one-degree movement steps; `0` snaps directly to the target angle

Each servo has its own settings. For example, servo `0` and servo `1` can use
different return angles, strike angles, dwell times, and speed settings.

For live tuning without restarting the keyboard controller, run:

```bash
python python/tune_servos.py --port /dev/cu.usbmodem1101
```

Then type commands like:

```text
set 0 90 60 80 0
hit 0
set 1 100 70 120 0
hit 1
status
```

Start with gentle strike angles and increase gradually. The Arduino powers only
the PCA9685 logic over I2C; the servos should stay on the external 5V supply.

## Pattern Playback

Pattern playback requires the current non-blocking firmware in
`arduino/firmware/robot_drummer_firmware/robot_drummer_firmware.ino`. Upload it
once through the Arduino IDE, then patterns can be changed without uploading
again.

Preview the included test beat without moving the servos:

```bash
python python/play_pattern.py --list-beats
python python/play_pattern.py --dry-run
```

Play it once, repeat it four times, or alter its speed:

```bash
python python/play_pattern.py
python python/play_pattern.py --beat basic_rock --repeat 4
python python/play_pattern.py --beat alternating_toms --repeat 4 --tempo 0.75
```

`--tempo` is a speed multiplier: `0.75` is slower, `1.0` is the written speed,
and `1.5` is 50% faster.

Press `Ctrl+C` to stop playback and return all sticks to rest. The included
`patterns/simple_beat.json` file contains several named beats. Each beat uses
millisecond timestamps:

```json
{
  "default": "example",
  "beats": {
    "example": {
      "length_ms": 1000,
      "events": [
        {"time_ms": 0, "servo": 0},
        {"time_ms": 500, "servo": 1}
      ]
    }
  }
}
```

Events with the same `time_ms` are sent together for multi-drum hits. Make sure
the external servo power supply can safely provide the combined current.
