import test from "node:test";
import assert from "node:assert/strict";
import {
  shanghaiDay,
  cycleStatus,
  reconcileQuota,
} from "../src/storage/state.ts";
import { parseCompanySize } from "../src/domain/ranker.ts";

test("daily boundary uses Shanghai midnight, not UTC midnight", () => {
  assert.equal(shanghaiDay(new Date("2026-09-07T15:59:59Z")), "2026-09-07");
  assert.equal(shanghaiDay(new Date("2026-09-07T16:00:00Z")), "2026-09-08");
});
test("unfinished stale cycles never appear as successful dispatches", () => {
  assert.equal(
    cycleStatus(
      { id: "a", status: "queued", at: "2026-09-07T00:00:00Z" },
      Date.parse("2026-09-07T00:21:00Z"),
    ).state,
    "stalled",
  );
  assert.equal(
    cycleStatus({ id: "a", status: "blocked", reason: "navigation failed" })
      .reason,
    "navigation failed",
  );
});
test("unused successful reservations are released exactly once", () => {
  const c = {
    id: "a",
    at: "2026-09-07T00:00:00Z",
    status: "completed",
    newContactAllocation: 3,
    result: { newContacts: 1 },
  };
  const q = { date: "2026-09-07", reserved: 4 };
  const r = reconcileQuota(q, c);
  assert.equal(r.reserved, 2);
  assert.deepEqual(reconcileQuota(r, c), r);
  assert.deepEqual(reconcileQuota(q, { ...c, status: "blocked" }), q);
  assert.deepEqual(reconcileQuota(q, { ...c, result: { newContacts: 4 } }), q);
});
test("company-size parser refuses JD counts and ambiguous sizes", () => {
  assert.equal(parseCompanySize("团队处理1000人数据"), null);
  assert.equal(parseCompanySize("999-500人"), null);
  assert.equal(parseCompanySize("约500人"), null);
  assert.deepEqual(parseCompanySize("500-999人"), {
    minimum: 500,
    maximum: 999,
  });
});
