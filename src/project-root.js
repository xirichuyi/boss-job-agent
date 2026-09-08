import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const ROOT = path.resolve(process.env.BOSS_AGENT_ROOT || fileURLToPath(new URL('..', import.meta.url)));
