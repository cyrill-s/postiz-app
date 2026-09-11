"""Package local production builds on top of the existing pinned Linux release."""
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[2]
if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root).strip():
    raise SystemExit('Commit source changes before packaging.')
release = root / '.local-build/formatting-release'
if release.exists():
    shutil.rmtree(release)
release.mkdir(parents=True)
shutil.copytree(root / 'apps/frontend/.next', release / 'frontend-next',
                ignore=shutil.ignore_patterns('cache'))
for dependency in (release / 'frontend-next/node_modules').glob('isomorphic-dompurify-*'):
    if dependency.is_symlink():
        dependency.unlink()
    else:
        shutil.rmtree(dependency)
    dependency.symlink_to('/app/node_modules/isomorphic-dompurify', target_is_directory=True)
for app in ('backend', 'orchestrator'):
    shutil.copytree(root / f'apps/{app}/dist', release / f'overlay/apps/{app}/dist')
shutil.copy2(root / '.local-build/workflow-bundle.js', release / 'overlay/apps/orchestrator/workflow-bundle.js')
# Generate this client locally for debian-openssl-3.0.x with the same Prisma 6.5.0
# as production. Never copy macOS native modules into the Linux application.
shutil.copytree(root / '.local-build/formatting-prisma-client', release / 'overlay/node_modules/.prisma/client')
changed = subprocess.check_output(['git', 'diff', '--name-only', '--diff-filter=ACMR', 'v2.23.0', 'HEAD'], cwd=root, text=True).splitlines()
for name in changed:
    if name.startswith(('apps/', 'libraries/')) and not name.endswith('.spec.ts'):
        target = release / 'overlay' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, target)
source = release / 'public/source/postiz-vk-community.tar.gz'
source.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(['git', 'archive', '--format=tar.gz', '-o', str(source), 'HEAD'], cwd=root, check=True)
shutil.copy2(root / 'ops/formatting/Dockerfile', release / 'Dockerfile')
print(release)
