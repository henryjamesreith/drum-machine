# Drum Machine Console

Local Next.js control surface for the robot drummer.

The five active channels are cymbal, small tom, big tom/kick, small tom/snare,
and hi-hat.

## Setup

```bash
cd web
npm install
cp .env.local.example .env.local
```

Add your OpenAI API key to `.env.local`.

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

Saved and LLM-generated beats both run through the repo's existing Python player.
Generated beats are temporary files and are deleted when playback finishes.
Both paths support a `0.5x` to `2x` tempo multiplier and `1` to `16` loops.

```bash
.venv/bin/python python/play_pattern.py --beat <beat>
```

The app is local-first because hardware playback needs USB serial access to the Arduino.
