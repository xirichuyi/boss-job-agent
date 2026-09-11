import test from "node:test";
import assert from "node:assert/strict";
import {
  watchdogPlan,
  effectiveStatus,
} from "../src/runtime/service-health.ts";
const base = {
  enabled: true,
  service: "inactive",
  ageSeconds: 100,
  bootGrace: false,
  attempts: 0,
};
test("unexpected stopped service restarts; explicit pause is respected", () => {
  assert.equal(watchdogPlan(base), "start_stopped");
  assert.equal(watchdogPlan({ ...base, enabled: false }), "disabled");
});
test("maintenance expires and cannot silently stop forever", () => {
  assert.equal(
    watchdogPlan(
      { ...base, maintenance: { until: new Date(2000).toISOString() } },
      1000,
    ),
    "maintenance",
  );
  assert.equal(
    watchdogPlan(
      { ...base, maintenance: { until: new Date(2000).toISOString() } },
      3000,
    ),
    "start_stopped",
  );
});
test("worker timeout window is respected and stale supervisor recovers", () => {
  assert.equal(
    watchdogPlan({ ...base, service: "active", ageSeconds: 1000 }),
    "healthy",
  );
  assert.equal(
    watchdogPlan({ ...base, service: "active", ageSeconds: 1300 }),
    "restart_stale",
  );
  assert.equal(watchdogPlan({ ...base, attempts: 3 }), "cooldown");
  assert.equal(watchdogPlan({ ...base, service: "unknown" }), "observe");
});
test("stopped service cannot present historical waiting as current status", () => {
  assert.equal(
    effectiveStatus({ state: "waiting" }, { state: "inactive" }).state,
    "stopped",
  );
  assert.equal(
    effectiveStatus({ state: "waiting" }, { state: "active" }).state,
    "waiting",
  );
});
