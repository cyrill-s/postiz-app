"""Package Telegram artifacts over the deployed MAX release; never package env files."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

root = Path(__file__).resolve().parents[2]
if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root).strip():
    raise SystemExit('Commit source changes before packaging.')
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
release = root / '.local-build' / ('telegram-native-' + revision[:8])
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
    'libraries/nestjs-libraries/src/integrations/social/telegram.provider',
    'libraries/nestjs-libraries/src/integrations/social/telegram.updates',
    'libraries/nestjs-libraries/src/integrations/social/social.integrations.interface',
    'libraries/nestjs-libraries/src/database/prisma/posts/posts.service',
    'libraries/nestjs-libraries/src/database/prisma/integrations/integration.service',
    'libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository',
]
for app in ['backend', 'orchestrator']:
    modules = shared + (['apps/backend/src/api/routes/no.auth.integrations.controller'] if app == 'backend' else [])
    for module in modules:
        for extension in ['.js', '.js.map', '.d.ts']:
            relative = f'apps/{app}/dist/{module}{extension}'
            target = release / 'overlay' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / relative, target)
changed = subprocess.check_output([
    'git', 'diff', '--name-only', '--diff-filter=ACMR', '0145aabf', 'HEAD'
], cwd=root, text=True).splitlines()
for relative in changed:
    target = release / 'overlay' / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / relative, target)
source = release / 'public/source/postiz-vk-community.tar.gz'
source.parent.mkdir(parents=True)
subprocess.run(['git', 'archive', '--format=tar.gz', '-o', str(source), 'HEAD'], cwd=root, check=True)
shutil.copy2(root / 'ops/telegram/Dockerfile.native', release / 'Dockerfile')
(release / 'release.json').write_text(json.dumps({
    'revision': revision, 'baseImage': 'local/postiz:max-native-ac9bd184',
    'schemaMigration': False, 'workflowBundleChanged': False,
}, indent=2) + '\n')
manifest = [f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.relative_to(release)}'
            for file in sorted(release.rglob('*')) if file.is_file() and not file.is_symlink()]
(release / 'files.sha256').write_text('\n'.join(manifest) + '\n')
print(release)
