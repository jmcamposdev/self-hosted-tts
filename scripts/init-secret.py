import os
import secrets
from pathlib import Path

Path('.secrets').mkdir(mode=0o700, exist_ok=True)
path = Path('.secrets/api_key')
if path.exists():
    raise SystemExit('Secret already exists; refusing to replace it')
# Docker Compose bind-mounted secrets must be readable by container uid 1000.
# The parent directory is private to the host user; this file never enters Git.
with os.fdopen(os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600), 'w') as f:
    f.write(secrets.token_urlsafe(48)+'\n')
Path('storage').mkdir(exist_ok=True)
Path('models').mkdir(exist_ok=True)
env = Path('.env')
content = env.read_text() if env.exists() else ''
for name, value in [('TTS_UID', os.getuid()), ('TTS_GID', os.getgid())]:
    if not any(line.startswith(name+'=') for line in content.splitlines()):
        content += '\n'+name+'='+str(value)+'\n'
env.write_text(content)
print('Created private API key file. Its value is intentionally not printed.')
