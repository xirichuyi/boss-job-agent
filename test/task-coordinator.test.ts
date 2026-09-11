import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  PriorityMutex,
  coordinatedChat,
  runParallelLanes,
} from "../src/runtime/coordinator.ts";
import { createAsyncDecision } from "../src/application/async-decision.ts";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

test("search and inbox overlap, but completion waits for both lanes", async () => {
  const search = deferred(),
    inbox = deferred(),
    events = [];
  const run = runParallelLanes({
    search: async () => {
      events.push("search");
      await search.promise;
      events.push("search-done");
    },
    inbox: async () => {
      events.push("inbox");
      await inbox.promise;
      events.push("inbox-done");
    },
  });
  assert.deepEqual(events, ["search", "inbox"]);
  inbox.resolve();
  await Promise.resolve();
  assert.ok(!events.includes("search-done"));
  search.resolve();
  await run;
  assert.equal(events.length, 4);
});
test("one failed lane cannot close resources while the other still uses them", async () => {
  const other = deferred();
  let stopped = false,
    finished = false;
  const run = runParallelLanes(
    {
      inbox: async () => {
        throw Error("captcha");
      },
      search: async () => {
        await other.promise;
        finished = true;
      },
    },
    () => {
      stopped = true;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stopped, true);
  assert.equal(finished, false);
  other.resolve();
  await assert.rejects(run, /captcha/);
  assert.equal(finished, true);
});
test("chat actions are mutually exclusive and queued replies get priority", async () => {
  const mutex = new PriorityMutex(),
    gate = deferred(),
    events = [];
  const first = mutex.run(async () => {
    events.push("first");
    await gate.promise;
  });
  const outreach = mutex.run(() => events.push("outreach"), 0);
  const reply = mutex.run(() => events.push("reply"), 1);
  assert.deepEqual(events, ["first"]);
  gate.resolve();
  await Promise.all([first, outreach, reply]);
  assert.deepEqual(events, ["first", "reply", "outreach"]);
});
test("first contact holds a reentrant transaction through greeting and supplement", async () => {
  const mutex = new PriorityMutex(),
    gate = deferred(),
    events = [];
  const raw = {
    async openConversation() {
      events.push("open");
    },
    async sendText() {
      events.push("send");
    },
  };
  const chat = coordinatedChat(raw, mutex, 0);
  const contact = mutex.run(async () => {
    events.push("contact");
    await gate.promise;
    await chat.openConversation();
    await chat.sendText();
  });
  const reply = mutex.run(() => events.push("other-HR"), 1);
  gate.resolve();
  await Promise.all([contact, reply]);
  assert.deepEqual(events, ["contact", "open", "send", "other-HR"]);
});
test("lock releases on failure and cancelled queued actions do not execute", async () => {
  const mutex = new PriorityMutex();
  await assert.rejects(
    mutex.run(() => {
      throw Error("failed");
    }),
    /failed/,
  );
  let ran = false;
  const chat = coordinatedChat(
    {
      sendText() {
        ran = true;
      },
    },
    mutex,
    1,
    () => {
      throw Error("stopped");
    },
  );
  await assert.rejects(chat.sendText(), /stopped/);
  assert.equal(ran, false);
  assert.equal(await mutex.run(() => 42), 42);
});
test("model worker does not block browser work and preserves serialized budget calls", async () => {
  const workers = [];
  class FakeWorker extends EventEmitter {
    constructor(url, options) {
      super();
      this.options = options;
      workers.push(this);
    }
    finish(result) {
      this.emit("message", { type: "result", result });
      this.emit("exit", 0);
    }
  }
  const decide = createAsyncDecision({
    root: "/fixture",
    cycle: { id: "c" },
    progress() {},
    WorkerClass: FakeWorker,
  });
  const a = decide.batch([{ job: { id: "a" } }]);
  const b = decide({}, {}, "reply");
  assert.equal(workers.length, 1);
  let browserRan = false;
  await new Promise((r) =>
    setImmediate(() => {
      browserRan = true;
      r();
    }),
  );
  assert.equal(browserRan, true);
  workers[0].finish([{ action: "contact" }]);
  await a;
  assert.equal(workers.length, 2);
  workers[1].finish({ action: "reply" });
  assert.equal((await b).action, "reply");
});
test("worker error or missing result fails closed", async () => {
  class BrokenWorker extends EventEmitter {
    constructor() {
      super();
      setImmediate(() => this.emit("exit", 0));
    }
  }
  const decide = createAsyncDecision({
    root: "/fixture",
    cycle: { id: "c" },
    progress() {},
    WorkerClass: BrokenWorker,
  });
  await assert.rejects(decide({}, {}, "reply"), /没有可靠结果/);
});
