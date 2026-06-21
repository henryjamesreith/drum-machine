# YouTube → Drum Kit JSON Pipeline

Design document for the automated drum kit pipeline. Covers architecture decisions, tool choices, configuration, tuning, and upgrade paths.

---

## Objective

Take a YouTube music video URL as input and produce a JSON file that tells the drum kit firmware when to fire each servo. A MIDI file is always written alongside the JSON as a human-inspectable side-output.

---

## Pipeline Overview

```
YouTube URL
  → WAV           (yt-dlp + ffmpeg)
  → drum stem     (Demucs htdemucs model, GPU-accelerated)
  → onset events  (librosa, per-frequency-band onset detection)
  → quantized events
  → <title>.mid   [always written — open in GarageBand/Reaper to verify]
  → <title>.json  [firmware input]
```

---

## Environment Setup

```bash
conda create -n drum-machine python=3.10 -y
/path/to/miniforge3/envs/drum-machine/bin/python -m ensurepip --upgrade
/path/to/miniforge3/envs/drum-machine/bin/python -m pip install -r requirements.txt
```

**System dependency:** `ffmpeg` must be on `PATH` (used by yt-dlp for audio conversion).

**Run the pipeline:**
```bash
/path/to/miniforge3/envs/drum-machine/bin/python python/yt_to_json.py "<youtube_url>" -o output/
```

All subprocess calls in the script use `sys.executable` so they always resolve to the active conda env — no PATH issues.

---

## Tool Stack and Rationale

### YouTube download — `yt-dlp`
Standard choice. Downloads the audio track and converts to WAV via ffmpeg. Invoked as `python -m yt_dlp` to stay within the conda env.

### Drum stem isolation — `Demucs` (htdemucs model)

**Why not Spleeter:** Spleeter was the original plan (lighter, faster) but its dependency chain (old numpy, old numba, TensorFlow) cannot build cleanly on Python 3.10 with modern pip tooling. Installation always fails.

**Why Demucs:** PyTorch-based, actively maintained, better separation quality, and installs cleanly. Auto-detects CUDA on Linux (NVIDIA 3090) and falls back to CPU on Intel Mac — no code changes needed between platforms.

```bash
python -m demucs --two-stems=drums --name htdemucs --out <output_dir> <wav>
# Output: <output_dir>/htdemucs/<stem_name>/drums.wav
```

**Upgrade path within Demucs:** Change `htdemucs` → `htdemucs_ft` (fine-tuned variant) for better quality at the cost of speed. One-line change in `isolate_drums()`.

### Onset detection — `librosa`

After Demucs gives us a single drum stem (all drums mixed together), we run onset detection independently in each frequency band using bandpass filters (`scipy.signal.butter`). Each band maps to one drum type.

### MIDI — `mido`

Used to write the `.mid` side-output. Standard GM drum channel (channel 10 / index 9). Events at the same timestamp are grouped correctly so simultaneous hits land on the same tick. The MIDI file is for human inspection only — timing is approximate.

---

## Configuration

All prototype-tunable knobs are constants at the top of `python/yt_to_json.py`.

### Servo mapping
```python
DRUM_TO_SERVO: dict[str, int] = {
    "cymbal":      0,
    "small_tom_1": 1,
    "big_drum":    2,
    "small_tom_2": 3,
    "hi_hat":      4,
    "snare":       5,
}
```
Edit this to match physical wiring changes. Any drum type not listed here is silently ignored in output.

### Frequency bands
```python
FREQ_BANDS: dict[str, tuple[int, int]] = {
    "big_drum":    (20,    200),
    "small_tom_1": (150,   400),
    "small_tom_2": (300,   700),
    "snare":       (500,   3000),
    "cymbal":      (3000,  8000),
    "hi_hat":      (7000,  20000),
}
```
Onset detection runs independently in each band. A single physical drum hit will fire in every band whose frequency range overlaps with it — this is expected and is the classification mechanism.

**Known limitation:** `small_tom_1` and `small_tom_2` share overlapping frequency ranges and cannot be cleanly separated by frequency alone. Both may trigger on the same tom hit. See upgrade path below.

### Quantization
```python
QUANTIZE_MS: int = 125
```
All event timestamps are snapped to the nearest 125ms grid point. Lower values give tighter timing (firmware must support it). Change this freely during prototyping.

### Onset sensitivity
```python
ONSET_DELTA: float = 0.07
```
Controls how sensitive onset detection is within each frequency band. **Lower = more hits detected** (catches quiet hits, more false positives). **Higher = fewer hits detected** (only strong transients, fewer false positives).

**If the kit fires too chaotically**, raise this first — try `0.12` or `0.15`. If it's missing obvious hits, lower it toward `0.04`. This is the primary tuning knob for output quality.

### MIDI tempo
```python
MIDI_BPM: int = 120
```
Only affects the `.mid` side-output, not the JSON. Change if you want the MIDI to display at the correct BPM in a DAW.

---

## Output Format

### JSON (firmware input)
```json
{
  "default": "song_title_slug",
  "beats": {
    "song_title_slug": {
      "name": "Song Title Slug",
      "length_ms": 210000,
      "events": [
        {"time_ms": 0,   "servo": 2},
        {"time_ms": 125, "servo": 4},
        ...
      ]
    }
  }
}
```
- The beat key is derived from the YouTube video title (lowercased, non-alphanumeric → underscore).
- `length_ms` is the full song duration. The firmware plays the beat once (not looped) unless configured to loop.
- Events are sorted by `(time_ms, servo)`.
- Duplicate events (same servo, same quantized time) are deduplicated — first occurrence wins.

### MIDI side-output
Standard GM MIDI file, drum channel 10. Open in GarageBand, Reaper, or any DAW to visually verify that the right drums are firing at the right times before loading the JSON onto the kit.

---

## Known Limitations and Upgrade Paths

| Limitation | Current approach | Upgrade path |
|---|---|---|
| Tom-to-tom discrimination | Overlapping frequency bands — imperfect | Trained drum transcription model, e.g. [ADTLib](https://github.com/CarlSouthall/ADTLib) |
| Drum stem quality | Demucs htdemucs (good) | Switch to `htdemucs_ft` in `isolate_drums()` — one-line change |
| Hit classification | Frequency bands + onset detection | ML-based onset detection (e.g. madmom) or a dedicated drum transcription network |
| Velocity | All hits output at fixed MIDI velocity 100 | Onset strength from librosa can be used to estimate relative velocity |

---

## File Layout

```
drum-machine/
├── python/
│   ├── yt_to_json.py        ← this pipeline
│   ├── play_pattern.py
│   ├── tune_servos.py
│   └── manual_keyboard.py
├── output/                  ← generated .json and .mid files
├── arduino/
├── config/
├── docs/
├── patterns/
├── requirements.txt
└── PIPELINE.md              ← this file
```
