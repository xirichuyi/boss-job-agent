#!/usr/bin/env python3
"""Persistent, single-worker scheduler; no interactive Codex queue involved."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

ROOT = Path(os.environ.get('BOSS_AGENT_ROOT', Path(__file__).resolve().parents[1]))
MEMORY = ROOT / 'memory'
NODE_BINARY = os.environ.get('NODE_BINARY', 'node')


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def run_worker(command, timeout=900):
    child = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.DEVNULL,
                             start_new_session=True)
    try:
        return child.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        return 124


def tick(force=False):
    with open(MEMORY / 'scheduler.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 'already_running'
        if force:
            os.environ['JOB_AGENT_FORCE'] = '1'
        else:
            os.environ.pop('JOB_AGENT_FORCE', None)
        code = run_worker([NODE_BINARY, 'scripts/scheduled-agent.mjs'])
        if code == 124:
            subprocess.run([NODE_BINARY, 'scripts/harness-state.mjs', 'timeout'], cwd=ROOT, timeout=15, check=True)
            path = MEMORY / 'scheduled-cycle.json'
            cycle = json.loads(path.read_text()) if path.exists() else {}
            cycle.update(status='blocked', reason='worker_timeout_result_unconfirmed',
                         completedAt=timestamp())
            # Core cycle is already committed to Harness SQLite by harness-state.
            atomic_json(MEMORY / 'scheduler-status.json', {
                'checkedAt': timestamp(), 'state': 'blocked',
                'cycle': cycle.get('id'), 'reason': cycle['reason']})
        subprocess.run([NODE_BINARY, 'scripts/telegram-notify.mjs'], cwd=ROOT,
                       stdin=subprocess.DEVNULL, timeout=75, check=False)
        return code


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    while True:
        started = time.monotonic()
        try:
            result = tick(force=args.once)
            print(json.dumps({'at': timestamp(), 'tickResult': result}), flush=True)
        except Exception as error:
            subprocess.run([NODE_BINARY, 'scripts/harness-state.mjs', 'error'], cwd=ROOT, timeout=15, check=False)
            atomic_json(MEMORY / 'scheduler-status.json', {
                'checkedAt': timestamp(), 'state': 'error', 'reason': str(error)})
            print(str(error), flush=True)
            result = 1
        if args.once:
            return 0 if result in (0, 'already_running') else 1
        # Poll health/notifications every minute; dispatcher persists the 30-min
        # outreach cadence and retry backoff. Restarts cannot bypass that cadence.
        atomic_json(MEMORY / 'scheduler-heartbeat.json', {'at': timestamp(), 'pid': os.getpid()})
        time.sleep(max(1, 60 - (time.monotonic() - started)))


if __name__ == '__main__':
    raise SystemExit(main())
