#!/usr/bin/env python3
"""Host-specific HTTPS reply routing for poster (80.90.178.91).

The main table sends Telegram traffic through wg-aibot. Incoming HTTPS
connections need replies through the public interface, without changing bot
API egress. This helper owns only table/priority 11443 and these exact rules.
"""
import json
import subprocess
import sys

TABLE = '11443'
ADDRESS = '80.90.178.91'
NETWORKS = ('149.154.160.0/20', '91.108.4.0/22')


def run(*args, check=True):
    return subprocess.run(['ip', *args], check=check, capture_output=True, text=True)


def rule(network):
    return ['priority', TABLE, 'from', ADDRESS + '/32', 'to', network,
            'ipproto', 'tcp', 'sport', '443', 'lookup', TABLE]


def route(network):
    return ['table', TABLE, network, 'via', '80.90.178.1', 'dev', 'eth0',
            'onlink', 'src', ADDRESS]


def destination(rule):
    value = rule.get('dst', '')
    return value if '/' in value else value + '/' + str(rule.get('dstlen', 32))


action = sys.argv[1] if len(sys.argv) == 2 else ''
if action not in ('apply', 'rollback'):
    raise SystemExit('Usage: webhook-routing.py apply|rollback (poster host only)')

rules = json.loads(run('-j', 'rule', 'show').stdout)
owned = [r for r in rules if r.get('priority') == int(TABLE)]
for r in owned:
    assert (r.get('src') == ADDRESS and destination(r) in NETWORKS
            and str(r.get('table')) == TABLE and r.get('ipproto') == 'tcp'
            and str(r.get('sport')) == '443'), 'Unexpected rule at owned priority'
assert not any(str(r.get('table')) == TABLE and r not in owned for r in rules), 'Routing table used by another rule'
routes = run('-j', 'route', 'show', 'table', TABLE, check=False)
for r in json.loads(routes.stdout or '[]'):
    assert (r.get('dst') in NETWORKS and r.get('gateway') == '80.90.178.1'
            and r.get('dev') == 'eth0' and r.get('prefsrc') == ADDRESS), 'Unexpected route in owned table'

for network in NETWORKS:
    exists = any(destination(r) == network for r in owned)
    if action == 'apply':
        run('route', 'replace', *route(network))
        if not exists:
            run('rule', 'add', *rule(network))
    else:
        if exists:
            run('rule', 'del', *rule(network))
        result = run('route', 'del', *route(network), check=False)
        if result.returncode and 'No such process' not in result.stderr:
            raise RuntimeError(result.stderr.strip())
print('Telegram HTTPS reply routing: ' + action)
