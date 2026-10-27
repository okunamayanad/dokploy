import json
import os
import subprocess
from pathlib import Path

repository = os.environ['GITHUB_REPOSITORY']
version = os.environ['VERSION']
releases = json.loads(subprocess.check_output(['gh', 'api', f'repos/{repository}/releases?per_page=100']))
published = next(item for item in releases if item['tag_name'] == version)
notes = Path('release-notes.md').read_text()
manifest = json.loads(Path('release.json').read_text())
if notes.split('`').count(manifest['image']) != 1:
    raise ValueError('Release notes must contain exactly one pinned image')
Path('publish-release.json').write_text(json.dumps({'body': notes, 'draft': False, 'make_latest': 'true'}))
endpoint = f"repos/{repository}/releases/{published['id']}"
subprocess.run(['gh', 'api', '--method', 'PATCH', endpoint, '--input', 'publish-release.json', '--silent'], check=True)
verified = json.loads(subprocess.check_output(['gh', 'api', endpoint]))
if verified['body'] != notes or verified['draft'] or verified['tag_name'] != manifest['version']:
    raise ValueError('Published release metadata verification failed')
print(f'Published {version} with verified release notes and pinned image metadata.')
