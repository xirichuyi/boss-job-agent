import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { readState } from './harness-store.js';
export const digest = text => createHash('sha256').update(text).digest('hex');
export function profileContext(root) {
  const platform = readState(root + '/memory/platform-profile.json');
  const local = fs.readFileSync(root + '/candidate-profile.md', 'utf8');
  const manifest = readState(root + '/memory/candidate-context-source.json');
  const file = root + '/candidate-context.md';
  if (manifest?.platformHash === digest(JSON.stringify(platform)) && manifest?.localHash === digest(local) && fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    if (manifest.contextHash === digest(text)) return { source: 'platform_verified_digest', capturedAt: platform?.capturedAt, text };
  }
  // Never silently keep an obsolete digest. On changes, use the current source alone.
  return platform?.text ? { source: platform.source, capturedAt: platform.capturedAt, digestStale: true, text: platform.text }
    : { source: 'local_only', text: local };
}
export function jobContext(job) {
  return { id: job.id, title: job.title, company: job.company, location: job.location, salary: job.proof?.salary || job.salary,
    companySize: job.companySize || job.proof?.companySize, scaleEvidence: job.scaleEvidence,
    requirements: job.requirements, description: job.proof?.description || job.text || '' };
}
export function historyContext(history) {
  return { scope: history?.scope, empty: history?.empty,
    messages: (Array.isArray(history) ? history : history?.messages || []).map(m => ({ text: m.text, self: m.self, system: m.system, id: m.id })) };
}
