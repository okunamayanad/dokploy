import hashlib
import json
import os
import re
from pathlib import Path

r = json.loads(Path('packages/server/src/personal-release.json').read_text())
digest = json.loads(Path('image.json').read_text())['digest']
if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
    raise ValueError('Invalid image manifest digest')
r['image'] = f"{r['image']}:{r['version']}@{digest}"
r['commit'] = os.environ['GITHUB_SHA']
Path('release.json').write_text(json.dumps(r, indent=2) + '\n')
installer = Path('scripts/personal/install.sh').read_text()
installer = re.sub(r'DOKPLOY_VERSION="\$\{DOKPLOY_VERSION:-v[\d.]+\}"', f'DOKPLOY_VERSION="${{DOKPLOY_VERSION:-{r["version"]}}}"', installer)
Path('install.sh').write_text(installer)
Path('SHA256SUMS').write_text(''.join(f'{hashlib.sha256(Path(name).read_bytes()).hexdigest()}  {name}\n' for name in ['release.json', 'install.sh']))
Path('release-notes.md').write_text(f'''Personal Dokploy release with Docker Compose pull request previews.

- Upstream stable base: [{r['upstreamVersion']}](https://github.com/Dokploy/dokploy/releases/tag/{r['upstreamVersion']}).
- Also includes upstream canary development through `{r['canaryCommit']}`; this is not an upstream stable-only build.
- Fork source: `{r['commit']}`.
- Image (amd64 + arm64): `{r['image']}`.
- Four-part versioning; updates follow this fork's published releases.
- Independent personal migration history; upstream migrations run first.

For a fresh Linux installation, download `install.sh`, inspect it, then run `sudo bash install.sh`.
For an existing installation, first back up the database and `/etc/dokploy`, then use `sudo bash install.sh update`.
Installation on production servers is a separate step. Image rollback alone does not undo database migrations.
''')
