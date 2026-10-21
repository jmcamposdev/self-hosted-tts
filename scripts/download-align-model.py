"""Download pinned alignment weights with stdlib + curl, verifying file hashes."""
import hashlib
import json
import os
import subprocess
import urllib.request
from pathlib import Path

model='jonatasgrosman/wav2vec2-large-xlsr-53-spanish'
revision='96d7e9b4e4a78af515a3c6d3cee7c0826045d276'
root=Path(os.environ.get('ALIGN_MODEL_DIR','models/alignment'));root.mkdir(parents=True,exist_ok=True)
with urllib.request.urlopen(f'https://huggingface.co/api/models/{model}/revision/{revision}?blobs=true') as r:meta=json.load(r)
allowed={'config.json','preprocessor_config.json','tokenizer_config.json','special_tokens_map.json','vocab.json','pytorch_model.bin','model.safetensors'}
manifest=[]
for info in meta['siblings']:
    name=info['rfilename']
    if name not in allowed:continue
    path=root/name;partial=Path(str(path)+'.part');sha=info.get('lfs',{}).get('sha256')
    if not path.exists():
        args=['curl','-fL','--retry','4','--silent','--show-error']
        if partial.exists():args+=['-C','-']
        print('Downloading alignment',name,flush=True)
        subprocess.run(args+['-o',str(partial),f'https://huggingface.co/{model}/resolve/{revision}/{name}'],check=True)
        os.replace(partial,path)
    if path.stat().st_size!=info['size']:raise RuntimeError('Alignment file size mismatch: '+name)
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(4*1024**2),b''):h.update(chunk)
    if sha and h.hexdigest()!=sha:raise RuntimeError('Alignment weight hash mismatch: '+name)
    manifest.append(dict(file=name,size=info['size'],sha256=h.hexdigest()))
(root/'manifest.json').write_text(json.dumps(dict(model=model,revision=revision,files=manifest),indent=2)+'\n')
print('Alignment weights verified')
