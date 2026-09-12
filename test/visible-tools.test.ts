import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { VisibleTools } from "../src/adapters/browser/visible.ts";
import { AGENT } from "../src/config/agent.ts";
test("native scale change clears stale selections and applies configured codes", async () => {
  const active = new Set([301, 305]);
  const elements = new Map(
    [301, 302, 303, 304, 305, 306].map((key) => [
      key,
      {
        classList: { contains: () => active.has(key) },
        click: () => (active.has(key) ? active.delete(key) : active.add(key)),
        getAttribute: () => "sel-job-rec-scale-" + key,
        textContent: String(key),
      },
    ]),
  );
  const control = {
    textContent: "公司规模",
    querySelector: (s) => elements.get(Number(s.match(/scale-(\d+)/)[1])),
  };
  const document = {
    querySelectorAll: (s) =>
      s === ".condition-filter-select"
        ? [control]
        : [...active].map((k) => elements.get(k)),
  };
  const b = new VisibleTools();
  b.guard = async () => {};
  b.evaluate = async (expression) =>
    vm.runInNewContext(expression, { document });
  await b.filterCompanies();
  assert.deepEqual(
    [...active].sort(),
    [...AGENT.search.nativeScaleCodes].sort(),
  );
});
test("disabled contact buttons are rejected before click", async () => {
  for (const state of [
    "is-disabled",
    "disabled",
    "native",
    "aria",
    "pointer",
    "enabled",
  ]) {
    let clicked = 0;
    const button = {
      textContent: "立即沟通",
      disabled: state === "native",
      getAttribute: () => (state === "aria" ? "true" : null),
      classList: { contains: (cls) => cls === state },
      getBoundingClientRect: () => ({ width: 100 }),
      click: () => clicked++,
    };
    const card = {
      querySelector: () => ({ getAttribute: () => "/job_detail/job.html" }),
    };
    const detail = { innerText: "公司 · HR", querySelectorAll: () => [button] };
    const b = new VisibleTools();
    b.guard = async () => {};
    b.evaluate = async (expression) =>
      vm.runInNewContext(expression, {
        document: {
          querySelector: (s) => (s === ".job-card-wrap.active" ? card : detail),
        },
        getComputedStyle: () => ({
          pointerEvents: state === "pointer" ? "none" : "auto",
        }),
      });
    const job = { id: "job", identity: "公司 · HR" };
    assert.equal(await b.contactReady(job), state === "enabled");
    if (state === "enabled") {
      await b.contactOnce(job);
      assert.equal(clicked, 1);
    } else {
      await assert.rejects(b.contactOnce(job), /未点击/);
      assert.equal(clicked, 0);
    }
  }
});

test("native list expression compiles and does not navigate", async () => {
  const b = new VisibleTools();
  b.filterCompanies = async () => [];
  b.selectHangzhou = async () => {};
  b.until = async (expression) => {
    new vm.Script(expression);
    assert.ok(!expression.includes("location.href="));
    return [];
  };
  assert.deepEqual(await b.listJobs(), []);
});
test("send waits until button enabled before persisting send attempt", async () => {
  const b = new VisibleTools(),
    order = [];
  const history = { messages: [{ text: "送达 hi", self: true }] };
  b.openConversation = async () => history;
  b.evaluate = async (expression) => {
    new vm.Script(expression);
    order.push("evaluate");
    return false;
  };
  b.call = async () => {
    order.push("insert");
  };
  b.until = async (expression) => {
    new vm.Script(expression);
    order.push("wait");
    return { text: "送达" };
  };
  b.guard = async () => {};
  await b.sendText(
    { title: "AI", company: "公司", recruiter: "HR" },
    "针对岗位的真实介绍",
    history,
    () => order.push("persist"),
  );
  assert.ok(order.indexOf("wait") < order.indexOf("persist"));
});
test("changed history prevents sending", async () => {
  const b = new VisibleTools();
  b.openConversation = async () => ({
    messages: [{ text: "新回复", self: false }],
  });
  let attempted = false;
  await assert.rejects(
    b.sendText({}, "消息", { messages: [] }, () => {
      attempted = true;
    }),
    /历史变化/,
  );
  assert.equal(attempted, false);
});

test("contact search rejects stale query/loading and accepts a textless empty result", async () => {
  const b = new VisibleTools();
  b.evaluate = async () => true;
  let calls = 0;
  b.until = async (expression) => {
    if (++calls === 1) return true;
    const state = { content: "旧公司", loading: false };
    let empty = false;
    const result = { innerText: "", querySelector: () => (empty ? {} : null) };
    const evaluate = () =>
      vm.runInNewContext(expression, {
        document: {
          querySelector: (s) =>
            s === ".boss-search-result"
              ? result
              : { parentElement: { __vue__: state } },
        },
      });
    assert.equal(evaluate(), null);
    state.content = "新公司";
    state.loading = true;
    result.innerText = "旧结果";
    assert.equal(evaluate(), null);
    state.loading = false;
    result.innerText = "";
    empty = true;
    assert.equal(evaluate().empty, true);
    return { empty: true };
  };
  assert.equal((await b.searchHistory("新公司")).empty, true);
});
