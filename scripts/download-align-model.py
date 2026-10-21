"""Download pinned alignment weights with stdlib + curl, verifying file hashes."""
import json
import os
import urllib.request
from pathlib import Path
from _lib import load_pins, sha256_file, download_file_with_curl

pins = load_pins()["models"]["alignment"]
model = pins["model"]
revision = pins["revision"]

root = Path(os.environ.get('ALIGN_MODEL_DIR', 'models/alignment'))
root.mkdir(parents=True, exist_ok=True)

with urllib.request.urlopen(f'https://huggingface.co/api/models/{model}/revision/{revision}?blobs=true') as r:
    meta = json.load(r)

allowed = {
    'config.json', 'preprocessor_config.json', 'tokenizer_config.json',
    'special_tokens_map.json', 'vocab.json', 'pytorch_model.bin', 'model.safetensors'
}

manifest = []
for info in meta['siblings']:
    name = info['rfilename']
    if name not in allowed:
        continue
    path = root / name
    sha = info.get('lfs', {}).get('sha256')
    if not path.exists():
        print('Downloading alignment', name, flush=True)
        download_file_with_curl(
            f'https://huggingface.co/{model}/resolve/{revision}/{name}',
            path,
            expected_size=info['size'],
            expected_sha256=sha,
        )
    if path.stat().st_size != info['size']:
        raise RuntimeError('Alignment file size mismatch: ' + name)
    actual_sha = sha256_file(path)
    if sha and actual_sha != sha:
        raise RuntimeError('Alignment weight hash mismatch: ' + name)
    manifest.append(dict(file=name, size=info['size'], sha256=actual_sha))

(root / 'manifest.json').write_text(json.dumps(dict(model=model, revision=revision, files=manifest), indent=2) + '\n')
print('Alignment weights verified')
