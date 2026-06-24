# Robot Drummer

A five-servo desktop drum kit controlled by an Arduino Nano ESP32, a PCA9685
servo driver, and a local web app.

## Hardware

- Arduino Nano ESP32
- PCA9685 16-channel PWM servo driver
- Five servos on channels `0`–`4`
- External regulated 5V servo power supply

Power the Arduino over USB and the servos through the PCA9685 `V+` input. The
Arduino, PCA9685, and servo supply must share ground. Do not power the servos
from the Arduino.

| Channel | Instrument | Key |
| --- | --- | --- |
| 0 | Cymbal | A |
| 1 | Small tom | S |
| 2 | Big tom / kick | D |
| 3 | Small tom / snare | F |
| 4 | Hi-hat | G |

## 1. Upload the firmware

Open
`arduino/firmware/robot_drummer_firmware/robot_drummer_firmware.ino` in the
Arduino IDE.

Install the **Arduino Nano ESP32** board package and **Adafruit PWM Servo Driver
Library**, select the board and USB port, then upload the sketch.

## 2. Install the controller

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install pyserial

cd web
npm install
cp .env.local.example .env.local
```

An OpenAI API key in `web/.env.local` is optional. It is only needed to create
beats from written prompts:

```text
OPENAI_API_KEY=your_key
```

## 3. Run the web app

Connect the Arduino over USB, then:

```bash
cd web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). From the app you can:

- play saved beats;
- change tempo and loop count;
- enable **Keyboard controls** and play with `A`, `S`, `D`, `F`, and `G`;
- describe a beat for the AI to generate and play.

The app automatically looks for a connected Arduino. Only one program can use
its serial port at a time.

## Configuration

Edit `config/servos.json` to change the serial port, key mappings, rest and
strike angles, dwell time, or movement speed. Start with gentle strike angles
and increase them gradually.

Saved beats live in `patterns/simple_beat.json`.

## Command-line tools

The web app is the simplest way to operate the kit, but the controllers can
also be run directly from the repository root:

```bash
source .venv/bin/activate
python python/manual_keyboard.py
python python/play_pattern.py --beat basic_rock --repeat 4
python python/tune_servos.py
```

If the Arduino is not detected:

```bash
python python/manual_keyboard.py --list-ports
python python/manual_keyboard.py --port /dev/cu.usbmodem1101
```

See `docs/serial_protocol.md` for the firmware command protocol and
`PIPELINE.md` for the optional YouTube-to-pattern pipeline.
