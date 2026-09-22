"""Run on the production host after uploading index.html beside this file."""
from pathlib import Path
import datetime
import shutil
import subprocess

base = Path('/opt/postiz-next')
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = base / 'releases' / ('vk-review-' + stamp)
backup.mkdir(parents=True, mode=0o700)
compose = base / 'docker-compose.yaml'
caddy = Path('/etc/caddy/sites/postmill.caddy')
compose_text = compose.read_text()
caddy_text = caddy.read_text()
assert compose_text.count('DISABLE_REGISTRATION: "true"') == 1
assert '\thandle {\n\t\treverse_proxy 127.0.0.1:4011' in caddy_text
assert 'handle_path /about/*' not in caddy_text
shutil.copy2(compose, backup / 'docker-compose.yaml')
shutil.copy2(caddy, backup / 'postmill.caddy')
print('Backup (restore both files here if deployment fails):', backup, flush=True)
public = Path('/var/www/poster-about')
public.mkdir(parents=True, exist_ok=True, mode=0o755)
shutil.copyfile(Path(__file__).with_name('index.html'), public / 'index.html')
(public / 'index.html').chmod(0o644)
snippet = '\tredir /about /about/ 308\n\thandle_path /about/* {\n\t\troot * /var/www/poster-about\n\t\tfile_server\n\t}\n\n'
caddy.write_text(caddy_text.replace('\thandle {\n\t\treverse_proxy 127.0.0.1:4011', snippet + '\thandle {\n\t\treverse_proxy 127.0.0.1:4011'))
try:
    subprocess.run(['caddy', 'validate', '--config', '/etc/caddy/Caddyfile'], check=True)
except Exception:
    caddy.write_text(caddy_text)
    raise
subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
compose.write_text(compose_text.replace('DISABLE_REGISTRATION: "true"', 'DISABLE_REGISTRATION: "false"'))
subprocess.run(['docker', 'compose', '-f', 'docker-compose.yaml', '-f', 'docker-compose.vk-community.yaml', 'up', '-d', '--no-deps', 'app'], cwd=base, check=True)
print('Backup:', backup)
