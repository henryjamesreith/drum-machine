#!/usr/bin/env python3
"""
yt_to_json.py — YouTube music video → drum kit firmware JSON + MIDI

Pipeline:
  YouTube URL
    → WAV           (yt-dlp + ffmpeg)
    → drum stem     (Demucs htdemucs, GPU-accelerated on CUDA)
    → onset events  (librosa, per frequency band)
    → quantized events
    → <beat_key>.mid    [always written for inspection]
    → <beat_key>.json   [firmware input]

System requirements: ffmpeg
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
from itertools import groupby
from pathlib import Path

import librosa
import mido
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

# ──────────────────────────────────────────────────────────────────────────────
# Configuration — all prototype-tunable knobs live here
# ──────────────────────────────────────────────────────────────────────────────

# Physical servo wiring: drum name → servo index on the kit.
DRUM_TO_SERVO: dict[str, int] = {
    "cymbal":      0,
    "small_tom_1": 1,
    "big_drum":    2,
    "small_tom_2": 3,
    "hi_hat":      4,
    "snare":       5,
}

# Frequency bands (Hz) used to classify hits in the isolated drum stem.
# Onset detection runs independently in each band.
# Note: small_tom_1 / small_tom_2 share overlapping ranges — they cannot be
# cleanly separated by frequency alone at this stage. Upgrade path: swap
# bandpass + onset detection for a trained drum transcription model (e.g. ADTLib).
FREQ_BANDS: dict[str, tuple[int, int]] = {
    "big_drum":    (20,    200),
    "small_tom_1": (150,   400),
    "small_tom_2": (300,   700),
    "snare":       (500,   3000),
    "cymbal":      (3000,  8000),
    "hi_hat":      (7000,  20000),
}

# Onset sensitivity — lower detects more (quieter) hits; raise to cut false positives.
ONSET_DELTA: float = 0.07

# All event times snap to the nearest multiple of this value (milliseconds).
QUANTIZE_MS: int = 125

# Reference tempo written into the MIDI file (does not affect JSON timing).
MIDI_BPM: int = 120

# GM drum channel note numbers for the .mid side-output (channel 10 / index 9).
DRUM_MIDI_NOTES: dict[str, int] = {
    "big_drum":    36,  # Bass Drum 1
    "snare":       38,  # Acoustic Snare
    "hi_hat":      42,  # Closed Hi-Hat
    "cymbal":      49,  # Crash Cymbal 1
    "small_tom_1": 47,  # Low-Mid Tom
    "small_tom_2": 45,  # Low Tom
}

# ──────────────────────────────────────────────────────────────────────────────
# Audio utilities
# ──────────────────────────────────────────────────────────────────────────────

def bandpass(audio: np.ndarray, sr: int, low_hz: int, high_hz: int) -> np.ndarray:
    nyq = sr / 2.0
    low = max(low_hz / nyq, 1e-3)
    high = min(high_hz / nyq, 0.999)
    if low >= high:
        return audio
    sos = butter(4, [low, high], btype="band", output="sos")
    return sosfilt(sos, audio)


def detect_onsets(audio: np.ndarray, sr: int) -> np.ndarray:
    """Return onset times in seconds for the given (pre-filtered) audio signal."""
    frames = librosa.onset.onset_detect(
        y=audio, sr=sr, delta=ONSET_DELTA, backtrack=True, units="frames"
    )
    return librosa.frames_to_time(frames, sr=sr)


# ──────────────────────────────────────────────────────────────────────────────
# Pipeline steps
# ──────────────────────────────────────────────────────────────────────────────

def get_video_title(url: str) -> str:
    """Fetch the YouTube video title and return a filesystem-safe slug."""
    result = subprocess.run(
        [sys.executable, "-m", "yt_dlp", "--no-playlist", "--get-title", url],
        capture_output=True, text=True, check=True,
    )
    title = result.stdout.strip()
    return re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")


def download_audio(url: str, out_wav: Path) -> None:
    """Download the YouTube audio track as a WAV file via yt-dlp + ffmpeg."""
    subprocess.run(
        [
            sys.executable, "-m", "yt_dlp",
            "--no-playlist",
            "-x", "--audio-format", "wav",
            "-o", str(out_wav),
            url,
        ],
        check=True,
    )


def isolate_drums(wav_path: Path, output_dir: Path) -> Path:
    """
    Separate the drum stem using Demucs (htdemucs model).
    Auto-detects CUDA (NVIDIA 3090) and falls back to CPU (Intel Mac).
    Returns the path to the isolated drums.wav.

    To use the higher-quality fine-tuned model (slower), change "htdemucs" → "htdemucs_ft".
    """
    subprocess.run(
        [
            sys.executable, "-m", "demucs",
            "--two-stems=drums",
            "--name", "htdemucs",
            "--out", str(output_dir),
            str(wav_path),
        ],
        check=True,
    )
    return output_dir / "htdemucs" / wav_path.stem / "drums.wav"


def extract_events(drums_wav: Path) -> list[tuple[float, str]]:
    """
    Detect drum hits by running onset detection independently in each frequency band.
    Returns unsorted (time_seconds, drum_type) pairs.
    """
    audio, sr = librosa.load(str(drums_wav), sr=None, mono=True)
    events: list[tuple[float, str]] = []
    for drum_type, (low, high) in FREQ_BANDS.items():
        filtered = bandpass(audio, sr, low, high)
        for t in detect_onsets(filtered, sr):
            events.append((float(t), drum_type))
    return events


def quantize(time_s: float) -> int:
    """Snap a time in seconds to the nearest QUANTIZE_MS grid point."""
    return round((time_s * 1000.0) / QUANTIZE_MS) * QUANTIZE_MS


def build_event_list(raw_events: list[tuple[float, str]], duration_s: float) -> list[dict]:
    """
    Quantize, deduplicate (same servo + same grid slot → keep first), and sort
    by (time_ms, servo).
    """
    seen: set[tuple[int, int]] = set()
    result: list[dict] = []
    for time_s, drum_type in raw_events:
        servo = DRUM_TO_SERVO.get(drum_type)
        if servo is None:
            continue
        t_ms = quantize(time_s)
        if t_ms > int(duration_s * 1000):
            continue
        key = (t_ms, servo)
        if key in seen:
            continue
        seen.add(key)
        result.append({"time_ms": t_ms, "servo": servo})
    result.sort(key=lambda e: (e["time_ms"], e["servo"]))
    return result


def write_midi(events: list[dict], out_path: Path) -> None:
    """
    Write a GM-compatible MIDI file on drum channel 10 (index 9).
    Events at the same time_ms are grouped so they share the same absolute tick.
    """
    tempo = mido.bpm2tempo(MIDI_BPM)
    ticks_per_beat = 480
    mid = mido.MidiFile(ticks_per_beat=ticks_per_beat)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=tempo, time=0))

    servo_to_drum = {v: k for k, v in DRUM_TO_SERVO.items()}

    def ms_to_ticks(ms: int) -> int:
        return int((ms / 1000.0) * (MIDI_BPM / 60.0) * ticks_per_beat)

    prev_ticks = 0
    for t_ms, group in groupby(events, key=lambda e: e["time_ms"]):
        hits = list(group)
        abs_ticks = ms_to_ticks(t_ms)
        delta = max(abs_ticks - prev_ticks, 0)

        # note_on for all simultaneous hits; first gets the real delta, rest get 0
        for i, ev in enumerate(hits):
            drum_type = servo_to_drum.get(ev["servo"])
            note = DRUM_MIDI_NOTES.get(drum_type, 38) if drum_type else 38
            track.append(mido.Message(
                "note_on", channel=9, note=note, velocity=100, time=delta if i == 0 else 0
            ))

        # note_off immediately after (drums are effectively instantaneous)
        for i, ev in enumerate(hits):
            drum_type = servo_to_drum.get(ev["servo"])
            note = DRUM_MIDI_NOTES.get(drum_type, 38) if drum_type else 38
            track.append(mido.Message(
                "note_off", channel=9, note=note, velocity=0, time=1 if i == 0 else 0
            ))

        prev_ticks = abs_ticks

    mid.save(str(out_path))


def write_json(events: list[dict], duration_s: float, beat_key: str, out_path: Path) -> None:
    payload = {
        "default": beat_key,
        "beats": {
            beat_key: {
                "name": beat_key.replace("_", " ").title(),
                "length_ms": int(duration_s * 1000),
                "events": events,
            }
        },
    }
    out_path.write_text(json.dumps(payload, indent=2))


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert a YouTube music video to drum kit firmware JSON + MIDI."
    )
    parser.add_argument("url", help="YouTube video URL")
    parser.add_argument(
        "-o", "--output-dir", default=".", help="Directory for output files (default: .)"
    )
    args = parser.parse_args()

    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        print("[1/5] Fetching video title...")
        beat_key = get_video_title(args.url)
        print(f"      {beat_key}")

        print("[2/5] Downloading audio...")
        wav_path = tmp_path / "source.wav"
        download_audio(args.url, wav_path)

        print("[3/5] Isolating drum stem (Demucs)...")
        stems_dir = tmp_path / "stems"
        drums_wav = isolate_drums(wav_path, stems_dir)
        duration_s = sf.info(str(drums_wav)).duration
        print(f"      duration: {duration_s:.1f}s")

        print("[4/5] Detecting drum onsets...")
        raw_events = extract_events(drums_wav)
        events = build_event_list(raw_events, duration_s)
        print(f"      {len(events)} events across {len(FREQ_BANDS)} drum types")

        print("[5/5] Writing outputs...")
        midi_path = out / f"{beat_key}.mid"
        json_path = out / f"{beat_key}.json"
        write_midi(events, midi_path)
        write_json(events, duration_s, beat_key, json_path)
        print(f"      MIDI → {midi_path}")
        print(f"      JSON → {json_path}")


if __name__ == "__main__":
    main()
