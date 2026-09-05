"""Package locally compiled artifacts without Linux native dependencies."""
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[2]
release = root / '.local-build/release'
release.mkdir(parents=True, exist_ok=True)
if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root).strip():
    raise SystemExit('Commit source changes before packaging.')

shutil.copytree(root / 'apps/frontend/.next', release / 'frontend-next',
                dirs_exist_ok=True, ignore=shutil.ignore_patterns('cache'))
for app in ('backend', 'orchestrator'):
    for name in ('integration.manager', 'social/vk.community.provider'):
        path = f'libraries/nestjs-libraries/src/integrations/{name}'
        for extension in ('.js', '.js.map', '.d.ts'):
            target = release / f'overlay/apps/{app}/dist/{path}{extension}'
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / f'apps/backend/dist/{path}{extension}', target)
controller = 'apps/backend/src/api/routes/no.auth.integrations.controller'
for extension in ('.js', '.js.map', '.d.ts'):
    target = release / f'overlay/apps/backend/dist/{controller}{extension}'
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / f'apps/backend/dist/{controller}{extension}', target)

changed = subprocess.check_output(['git', 'diff', '--name-only', 'v2.23.0', 'HEAD'], cwd=root, text=True).splitlines()
for name in changed:
    if name.startswith(('apps/', 'libraries/')) and not name.endswith('.spec.ts'):
        target = release / 'overlay' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, target)

source = release / 'public/source/postiz-vk-community.tar.gz'
source.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(['git', 'archive', '--format=tar.gz', '-o', str(source), 'HEAD'], cwd=root, check=True)
shutil.copy2(root / 'ops/vk-community/Dockerfile', release / 'Dockerfile')
shutil.copy2(root / 'ops/vk-community/compose.override.yaml', release / 'compose.override.yaml')
print(release)
