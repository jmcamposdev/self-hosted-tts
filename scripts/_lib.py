import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Optional

def load_pins() -> dict:
    pins_path = Path(__file__).resolve().parent / "pins.json"
    with open(pins_path, "r", encoding="utf-8") as f:
        return json.load(f)

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def download_file_with_curl(url: str, dest: Path, expected_size: Optional[int] = None, expected_sha256: Optional[str] = None):
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = Path(str(dest) + ".part")
    args = ["curl", "-fL", "--retry", "4", "--retry-delay", "2", "--silent", "--show-error"]
    if partial.exists():
        args += ["-C", "-"]
    args += ["-o", str(partial), url]
    subprocess.run(args, check=True)

    if expected_size is not None and partial.stat().st_size != expected_size:
        raise RuntimeError(f"Size mismatch downloading {url}: expected {expected_size}, got {partial.stat().st_size}")

    if expected_sha256 is not None:
        digest = sha256_file(partial)
        if digest != expected_sha256:
            raise RuntimeError(f"SHA-256 mismatch downloading {url}: expected {expected_sha256}, got {digest}")

    os.replace(partial, dest)
