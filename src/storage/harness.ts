import { ROOT } from "../project-root.ts";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export class HarnessStore {
  db: DatabaseSync;
  constructor(file) {
    this.db = new DatabaseSync(file, { timeout: 5000 });
    if (file !== ":memory:") fs.chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS documents(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, source TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', cycle TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);`);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS lease(name TEXT PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL)",
    );
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  read(key, fallback = null) {
    const row = this.db
      .prepare("SELECT value FROM documents WHERE key=?")
      .get(key);
    return row ? JSON.parse(String(row.value)) : fallback;
  }
  put(key, value) {
    this.db
      .prepare(
        "INSERT INTO documents VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
    if (
      key === "scheduled-cycle.json" &&
      ["completed", "blocked", "quarantined", "skipped"].includes(value.status)
    )
      this.db
        .prepare("UPDATE requests SET state=? WHERE cycle=?")
        .run(value.status, value.id);
  }
  batch(entries) {
    return this.transaction(() => {
      for (const [key, value] of entries) this.put(key, value);
    });
  }
  event(kind, detail) {
    this.db
      .prepare("INSERT INTO events(at,kind,detail) VALUES(?,?,?)")
      .run(new Date().toISOString(), kind, JSON.stringify(detail));
  }
  enqueue(source, id = randomUUID()) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO requests(id,source,created_at) VALUES(?,?,?)",
      )
      .run(id, source, new Date().toISOString());
    return id;
  }
  pending() {
    return this.db
      .prepare(
        "SELECT * FROM requests WHERE state='pending' ORDER BY created_at",
      )
      .all();
  }
  admit(entries, cycle) {
    this.transaction(() => {
      for (const [key, value] of entries) this.put(key, value);
      this.db
        .prepare(
          "UPDATE requests SET state='admitted', cycle=? WHERE state='pending'",
        )
        .run(cycle);
      this.event("cycle_admitted", { cycle });
    });
  }
  close() {
    this.db.close();
  }
  acquire(
    pid = process.pid,
    alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return e.code !== "ESRCH";
      }
    },
  ) {
    return this.transaction(() => {
      const current = this.db
        .prepare("SELECT * FROM lease WHERE name='executor'")
        .get();
      if (current && alive(current.pid)) return null;
      const token = randomUUID();
      this.db
        .prepare("INSERT OR REPLACE INTO lease VALUES('executor',?,?)")
        .run(token, pid);
      return token;
    });
  }
  owns(token) {
    return (
      !!token &&
      this.db.prepare("SELECT token FROM lease WHERE name='executor'").get()
        ?.token === token
    );
  }
  release(token) {
    this.db
      .prepare("DELETE FROM lease WHERE name='executor' AND token=?")
      .run(token);
  }
}
const memory = ROOT + "/memory";
const names = new Set([
  "schedule.json",
  "maintenance.json",
  "scheduled-cycle.json",
  "contact-quota.json",
  "outreach-ledger.json",
  "retry-state.json",
  "search-cursor.json",
  "inbox-cursor.json",
  "scheduler-status.json",
  "model-budget.json",
]);
export function stateKey(file) {
  const key = path.relative(memory, path.resolve(file));
  return names.has(key) || /^cycles\/[a-f0-9-]{36}\.json$/.test(key)
    ? key
    : null;
}
let singleton;
export function harness() {
  if (!fs.existsSync(memory + "/harness.sqlite")) return null;
  return (singleton ||= new HarnessStore(memory + "/harness.sqlite"));
}
export function readState(file, fallback = null) {
  const key = stateKey(file),
    store = key && harness();
  // After migration SQLite is authoritative; never silently fall back to stale exports.
  if (store) return store.read(key, fallback);
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : fallback;
}
