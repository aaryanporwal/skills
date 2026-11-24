# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["kokoro==0.9.4", "soundfile", "numpy<2.3", "mlx-whisper==0.4.2"]
# ///
"""Local voice-over: Kokoro-82M speaks each line on this Mac, then Whisper writes down what it heard.

Called by lib/voice.ts with one JSON job file:
  {"speaker": "af_heart", "speed": 0.9, "lines": [{"id": "...", "text": "...", "out": "/abs/x.wav"}]}
Prints one JSON line per clip: {"id", "out", "seconds", "heard"}. Lines whose file exists are only measured.
No network after the first run (the models are cached in ~/.cache/huggingface).
"""
import json
import sys
import warnings

import numpy as np
import soundfile as sf

warnings.filterwarnings("ignore")
RATE = 24000
WHISPER = "mlx-community/whisper-large-v3-turbo"


def main() -> None:
    job = json.load(open(sys.argv[1]))
    todo = [line for line in job["lines"] if not _exists(line["out"])]
    if todo:
        from kokoro import KPipeline

        pipe = KPipeline(lang_code=job["speaker"][0], repo_id="hexgrad/Kokoro-82M")
        for line in todo:
            parts = [audio.numpy() for _, _, audio in pipe(line["text"], voice=job["speaker"], speed=job["speed"])]
            audio = np.concatenate(parts) if parts else np.zeros(RATE // 2, dtype=np.float32)
            sf.write(line["out"], _trim(audio), RATE, subtype="PCM_24")

    import mlx_whisper

    for line in job["lines"]:
        audio, rate = sf.read(line["out"], dtype="float32")
        heard = mlx_whisper.transcribe(line["out"], path_or_hf_repo=WHISPER, language="en")["text"].strip()
        print(json.dumps({"id": line["id"], "out": line["out"], "seconds": round(len(audio) / rate, 3), "heard": heard}), flush=True)


def _exists(path: str) -> bool:
    try:
        return sf.info(path).frames > 0
    except Exception:
        return False


def _trim(audio: np.ndarray) -> np.ndarray:
    """Cut silence at both ends, keeping 40 ms, so a clip starts and ends where the words do."""
    loud = np.flatnonzero(np.abs(audio) > 0.01)
    if not loud.size:
        return audio
    pad = int(0.04 * RATE)
    return audio[max(0, loud[0] - pad) : loud[-1] + pad]


if __name__ == "__main__":
    main()
