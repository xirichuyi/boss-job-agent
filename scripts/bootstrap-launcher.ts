import fs from "node:fs";
import { renderBootstrapLauncher } from "../src/installation/bootstrap-launcher.ts";
const [user, workspace, node, searchPath] = process.argv.slice(2);
if (
  process.getuid?.() !== 0 ||
  !/^[a-z_][a-z0-9_-]*$/.test(user) ||
  user === "root"
)
  throw Error("root installer and non-root runtime user required");
const script = renderBootstrapLauncher(user, workspace, node, searchPath);
const target = "/usr/local/bin/boss-agent";
if (fs.existsSync(target)) {
  if (fs.readFileSync(target, "utf8") !== script)
    throw Error("已有 boss-agent 命令不同，拒绝覆盖");
} else fs.writeFileSync(target, script, { flag: "wx", mode: 0o755 });
