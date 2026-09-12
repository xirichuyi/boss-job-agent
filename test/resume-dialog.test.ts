import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { finishClosingResumeDialogExpression } from "../src/adapters/browser/resume-dialog.ts";
import { VisibleTools } from "../src/adapters/browser/visible.ts";
import { AGENT } from "../src/config/agent.ts";

test("only zero-duration stranded close callbacks are completed", () => {
  for (const state of ["closing", "open", "animating", "hidden", "cancelled"]) {
    let closed = 0;
    const callback = Object.assign(
      () => {
        closed++;
      },
      { cancelled: state === "cancelled" },
    );
    const dialog = {
      getBoundingClientRect: () => ({ width: 580, height: 380 }),
      checkVisibility: () => state !== "hidden",
      classList: { contains: () => state !== "open" },
      _leaveCb: callback,
      getAnimations: () =>
        state === "animating" ? [{ playState: "running" }] : [],
    };
    vm.runInNewContext(finishClosingResumeDialogExpression, {
      document: { querySelectorAll: () => [dialog] },
      getComputedStyle: () => ({
        animationDuration: "0s",
        transitionDuration: "0s",
      }),
    });
    assert.equal(closed, state === "closing" ? 1 : 0, state);
  }
});

test("pre-existing user resume dialog is neither sent nor closed", async () => {
  const b = new VisibleTools();
  const history = { messages: [] };
  b.openConversation = async () => history;
  const expressions = [];
  b.evaluate = async (expression) => {
    expressions.push(expression);
    if (expression === finishClosingResumeDialogExpression) return "open";
    throw Error("已有简历弹窗，暂停核对");
  };
  let attempts = 0;
  await assert.rejects(
    b.sendResume({ company: "公司" }, AGENT.resumeFile, history, () => {
      attempts++;
    }),
    /已有简历弹窗/,
  );
  assert.equal(attempts, 0);
  assert.equal(expressions.length, 2, "no cleanup of an unowned dialog");
});

test("resume UI selects configured file, persists intent, confirms a new receipt and closes", async () => {
  const b = new VisibleTools();
  const job = { id: "job", recruiter: "HR", title: "开发", company: "公司" };
  const history = { messages: [] };
  let opened = false,
    selected = false,
    persisted = false,
    sent = 0,
    closed = 0;
  const messages = [];
  const native = {
    encryptJobId: "job",
    encryptBossId: "boss",
    name: "HR",
    brandName: "公司",
    jobName: "开发",
  };
  const confirm = {
    disabled: false,
    classList: { contains: () => false },
    click: () => {
      assert.equal(persisted, true);
      assert.equal(selected, true);
      sent++;
      messages.push({
        innerText: "您的附件简历已发送给Boss",
        getAttribute: () => "receipt-new",
        classList: { contains: (s) => s === "item-system" },
      });
    },
  };
  const file = {
    querySelector: () => ({ textContent: AGENT.resumeFile }),
    click: () => {
      selected = true;
    },
  };
  const dialog = {
    getBoundingClientRect: () => ({ width: 580, height: 380 }),
    checkVisibility: () => opened,
    classList: { contains: () => false },
    querySelectorAll: () => [file],
    querySelector: (s) =>
      s === ".resume-list"
        ? {}
        : s === ".btn-confirm"
          ? confirm
          : s === ".boss-popup__close"
            ? {
                click: () => {
                  opened = false;
                  closed++;
                },
              }
            : s === ".list-item.selected .resume-name" && selected
              ? { textContent: AGENT.resumeFile }
              : null,
  };
  const chat = {
    __vue__: { selectedFriend$: native },
    querySelectorAll: () => messages,
    querySelector: (s) =>
      s === ".top-info-content"
        ? { __vue__: { conversation$: native } }
        : { textContent: s.includes("name-text") ? "HR" : "开发" },
  };
  const document = {
    querySelectorAll: (s) =>
      s.includes("choose-resume-dialog") ? (opened ? [dialog] : []) : messages,
    querySelector: (s) =>
      s.includes("62009")
        ? {
            classList: { contains: () => false },
            getAttribute: () => null,
            click: () => {
              opened = true;
            },
          }
        : chat,
  };
  b.openConversation = async () => history;
  b.guard = async () => {};
  b.evaluate = async (expression) =>
    vm.runInNewContext(expression, {
      document,
      getComputedStyle: () => ({
        animationDuration: "0s",
        transitionDuration: "0s",
      }),
    });
  b.until = async (expression) => {
    const result = await b.evaluate(expression);
    assert.ok(result, "expected UI condition is ready");
    return result;
  };
  const receipt = await b.sendResume(job, AGENT.resumeFile, history, () => {
    persisted = true;
  });
  assert.equal(receipt.id, "receipt-new");
  assert.equal(receipt.filename, AGENT.resumeFile);
  assert.equal(sent, 1);
  assert.equal(closed, 1);
  assert.equal(opened, false);
});
