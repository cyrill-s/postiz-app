"""Package the MAX change on the current production baseline, without secrets."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

root = Path(__file__).resolve().parents[2]
if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root).strip():
    raise SystemExit('Commit reviewed source changes before packaging.')
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
release = root / '.local-build' / ('max-native-' + revision[:8])
release.mkdir(parents=True, exist_ok=False)
shutil.copytree(root / 'apps/frontend/.next', release / 'frontend-next',
                ignore=shutil.ignore_patterns('cache'))
for dependency in (release / 'frontend-next/node_modules').glob('isomorphic-dompurify-*'):
    if dependency.is_symlink():
        dependency.unlink()
    else:
        shutil.rmtree(dependency)
    dependency.symlink_to('/app/node_modules/isomorphic-dompurify', target_is_directory=True)

shared = [
    'libraries/helpers/src/utils/social-formatting',
    'libraries/nestjs-libraries/src/database/prisma/posts/posts.service',
    'libraries/nestjs-libraries/src/integrations/social/max.provider',
    'libraries/nestjs-libraries/src/integrations/social/social.integrations.interface',
]
for app in ['backend', 'orchestrator']:
    modules = shared + (['apps/orchestrator/src/activities/post.activity'] if app == 'orchestrator' else [])
    for module in modules:
        for extension in ['.js', '.js.map', '.d.ts']:
            relative = f'apps/{app}/dist/{module}{extension}'
            target = release / 'overlay' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / relative, target)

changed = subprocess.check_output([
    'git', 'diff', '--name-only', '--diff-filter=ACMR',
    'b60c6c0277ecfb5f49537041e9a93f8b9b76b895', 'HEAD'
], cwd=root, text=True).splitlines()
for relative in changed:
    target = release / 'overlay' / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / relative, target)
source = release / 'public/source/postiz-vk-community.tar.gz'
source.parent.mkdir(parents=True)
subprocess.run(['git', 'archive', '--format=tar.gz', '-o', str(source), 'HEAD'], cwd=root, check=True)
shutil.copy2(root / 'ops/max/Dockerfile.native', release / 'Dockerfile')
(release / 'release.json').write_text(json.dumps({
    'revision': revision,
    'baseImage': 'local/postiz:readiness-97-b60c6c02',
    'schemaMigration': False,
    'workflowBundleChanged': False,
}, indent=2) + '\n')
manifest = []
for file in sorted(release.rglob('*')):
    if file.is_file() and not file.is_symlink():
        manifest.append(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.relative_to(release)}')
(release / 'files.sha256').write_text('\n'.join(manifest) + '\n')
print(release)
