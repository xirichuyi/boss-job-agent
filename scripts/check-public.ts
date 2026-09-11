import fs from "node:fs";
import { execFileSync } from "node:child_process";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const forbidden =
  /(^|\/)(memory|backups|node_modules|__pycache__)(\/|$)|candidate-(profile|context)\.md$|\.(env|sqlite|db|pdf|har|pyc)$|config\/private/;
const credentials =
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{30,}|\d{7,12}:[A-Za-z0-9_-]{30,})\b|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/;
const problems = [];
for (const file of files) {
  if (forbidden.test(file) && file !== "examples/candidate-profile.md")
    problems.push(file + ": private path");
  if (credentials.test(fs.readFileSync(file, "utf8")))
    problems.push(file + ": possible credential");
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Public-file checks passed (${files.length} files). Heuristic scan is not a privacy guarantee; review staged diff too.`,
  );
