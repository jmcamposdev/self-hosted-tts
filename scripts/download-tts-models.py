"""Download pinned official weights, verify SHA-256, and share identical codec blobs."""
import hashlib
import json
import os
import subprocess
import urllib.request
from pathlib import Path

MODELS = [
    ('base', 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', 'fd4b254389122332181a7c3db7f27e918eec64e3'),
    ('custom', 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', '0c0e3051f131929182e2c023b9537f8b1c68adfe'),
]
FILES = ['config.json','generation_config.json','tokenizer_config.json','preprocessor_config.json','model.safetensors','vocab.json','merges.txt'] + ['speech_tokenizer/'+name for name in ['config.json','configuration.json','model.safetensors','preprocessor_config.json']]


def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(4*1024**2),b''):h.update(block)
    return h.hexdigest()


root=Path(os.environ.get('MODELS_DIR','models'));root.mkdir(exist_ok=True)
manifest=[]
for directory, model, revision in MODELS:
    with urllib.request.urlopen(f'https://huggingface.co/api/models/{model}/revision/{revision}?blobs=true') as r:meta=json.load(r)
    for name in FILES:
        info=next(x for x in meta['siblings'] if x['rfilename']==name)
        path=root/directory/name;path.parent.mkdir(parents=True,exist_ok=True)
        sha=info.get('lfs',{}).get('sha256');size=info['size']
        if not path.exists() and directory=='custom' and name.startswith('speech_tokenizer/'):
            sibling=root/'base'/name
            if sha and sibling.exists() and digest(sibling)==sha:os.link(sibling,path)
        if not path.exists():
            partial=str(path)+'.part'
            args=['curl','-fL','--retry','4','--retry-delay','2','--silent','--show-error']
            if Path(partial).exists():args+=['-C','-']
            print('Downloading',model,name,flush=True)
            subprocess.run(args+['-o',partial,f'https://huggingface.co/{model}/resolve/{revision}/{name}'],check=True)
            if Path(partial).stat().st_size!=size or (sha and digest(partial)!=sha):raise RuntimeError('Downloaded weight validation failed: '+name)
            os.replace(partial,path)
        if path.stat().st_size!=size or (sha and digest(path)!=sha):raise RuntimeError('Existing file validation failed: '+str(path))
        manifest.append(dict(model=model,revision=revision,file=name,size=size,sha256=sha))
(root/'tts-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('All TTS weights verified')
