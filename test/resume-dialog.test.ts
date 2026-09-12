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
