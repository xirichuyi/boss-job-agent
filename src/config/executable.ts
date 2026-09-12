import fs from "node:fs";
import path from "node:path";

export function resolveExecutable(binary: string) {
  if (path.isAbsolute(binary)) return binary;
  if (!/^[a-zA-Z0-9_.-]+$/.test(binary)) throw Error("程序名无效");
  for (const directory of (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)) {
    const candidate = path.resolve(directory, binary);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return binary; // Dependency check reports missing; never guess an installation path.
}
