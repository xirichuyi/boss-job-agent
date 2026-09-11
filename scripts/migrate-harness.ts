import { ROOT } from "../src/project-root.ts";
import fs from "node:fs";
import { HarnessStore, stateKey } from "../src/storage/harness.ts";
const memory = ROOT + "/memory";
if (fs.existsSync(memory + "/harness.sqlite"))
  throw Error("数据库已存在，禁止覆盖迁移");
const files = [
  ...fs.readdirSync(memory).map((f) => memory + "/" + f),
  ...fs.readdirSync(memory + "/cycles").map((f) => memory + "/cycles/" + f),
].filter(stateKey);
// Parse everything before creating the database; any invalid source fails closed.
const entries = files.map((f) => [
  stateKey(f),
  JSON.parse(fs.readFileSync(f, "utf8")),
]);
const store = new HarnessStore(memory + "/harness.sqlite");
store.batch(entries);
store.event("migration", { documents: entries.length });
console.log(
  JSON.stringify({
    migrated: entries.length,
    integrity: store.db.prepare("PRAGMA integrity_check").get(),
  }),
);
store.close();
