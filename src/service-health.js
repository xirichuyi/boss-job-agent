import { spawnSync } from 'node:child_process';
export function serviceHealth(runner = spawnSync) {
  const r = runner('/usr/bin/systemctl', ['show', 'job-agent-scheduler.service', '--property=ActiveState,SubState,ActiveEnterTimestampMonotonic'], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return { state: 'unknown' };
  const fields = Object.fromEntries(r.stdout.trim().split('\n').map(l => l.split('=')));
  return { state: fields.ActiveState, substate: fields.SubState };
}
export function effectiveStatus(status, service) {
  if (service.state === 'active') return status;
  return { ...status, state: service.state === 'unknown' ? 'service_unknown' : 'stopped', phase: undefined,
    reason: '调度服务当前未运行，以下周期信息只是历史记录', previousState: status.state };
}
export function watchdogPlan({ enabled, maintenance, service, ageSeconds, bootGrace, attempts }, now = Date.now()) {
  if (!enabled) return 'disabled';
  if (Date.parse(maintenance?.until || '') > now) return 'maintenance';
  if (service === 'unknown' || ['activating', 'deactivating'].includes(service)) return 'observe';
  if (service === 'active' && (bootGrace || ageSeconds < 1200)) return 'healthy';
  if (attempts >= 3) return 'cooldown';
  return service === 'active' ? 'restart_stale' : 'start_stopped';
}
