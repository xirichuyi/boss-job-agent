import { fileURLToPath } from "node:url";
import path from "node:path";
export const CODE_ROOT = fileURLToPath(new URL("..", import.meta.url));
// Legacy BOSS_AGENT_ROOT remains a data-root alias. Executables never come from it.
export const ROOT = path.resolve(
  process.env.BOSS_DATA_DIR || process.env.BOSS_AGENT_ROOT || CODE_ROOT,
);
