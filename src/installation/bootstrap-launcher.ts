import path from "node:path";
import { CODE_ROOT } from "../project-root.ts";

export function renderBootstrapLauncher(
  user: string,
  workspace: string,
  node: string,
  searchPath: string,
) {
  if (!/^[a-z_][a-z0-9_-]*$/.test(user) || user === "root")
    throw Error("non-root runtime user required");
  if (
    ![workspace, node].every((value) => path.isAbsolute(value)) ||
    [workspace, node, searchPath].some((value) => /[\n\r\0]/.test(value))
  )
    throw Error("invalid launcher paths");
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const command = `env -u CODEX_HOME PATH=${quote(searchPath)} ${quote(node)} ${quote(path.join(CODE_ROOT, "scripts/install-agent.ts"))} "$@" --workspace ${quote(workspace)}`;
  return `#!/bin/bash\nset -euo pipefail\nif [[ $EUID == 0 ]]; then\n  exec runuser -u ${quote(user)} -- ${command}\nfi\nif [[ "$(id -un)" != ${quote(user)} ]]; then\n  echo '请用 sudo boss-agent 操作固定运行用户的工作区' >&2; exit 1\nfi\nexec ${command}\n`;
}
