"""Download pinned official weights, verify SHA-256, and share identical codec blobs."""
import json
import os
import urllib.request
from pathlib import Path
from _lib import load_pins, sha256_file, download_file_with_curl

pins = load_pins()["models"]
MODELS = [
    ('base', pins['base']['model'], pins['base']['revision']),
    ('custom', pins['custom']['model'], pins['custom']['revision']),
]
FILES = [
    'config.json', 'generation_config.json', 'tokenizer_config.json',
    'preprocessor_config.json', 'model.safetensors', 'vocab.json', 'merges.txt'
] + ['speech_tokenizer/' + name for name in ['config.json', 'configuration.json', 'model.safetensors', 'preprocessor_config.json']]

root = Path(os.environ.get('MODELS_DIR', 'models'))
root.mkdir(exist_ok=True)
manifest = []

for directory, model, revision in MODELS:
    with urllib.request.urlopen(f'https://huggingface.co/api/models/{model}/revision/{revision}?blobs=true') as r:
        meta = json.load(r)
    for name in FILES:
        info = next(x for x in meta['siblings'] if x['rfilename'] == name)
        path = root / directory / name
        path.parent.mkdir(parents=True, exist_ok=True)
        sha = info.get('lfs', {}).get('sha256')
        size = info['size']

        if not path.exists() and directory == 'custom' and name.startswith('speech_tokenizer/'):
            sibling = root / 'base' / name
            if sha and sibling.exists() and sha256_file(sibling) == sha:
                os.link(sibling, path)

        if not path.exists():
            print('Downloading', model, name, flush=True)
            download_file_with_curl(
                f'https://huggingface.co/{model}/resolve/{revision}/{name}',
                path,
                expected_size=size,
                expected_sha256=sha,
            )

        if path.stat().st_size != size or (sha and sha256_file(path) != sha):
            raise RuntimeError('File validation failed: ' + str(path))

        manifest.append(dict(model=model, revision=revision, file=name, size=size, sha256=sha))

(root / 'tts-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('All TTS weights verified')
