import { ROOT } from "../src/project-root.ts";
import { AGENT } from "../src/config/agent.ts";
import { MODEL, REASONING_EFFORT } from "../src/config/model.ts";
import { readState, harness } from "../src/storage/harness.ts";
import fs from "node:fs";
import { cycleStatus } from "../src/storage/state.ts";
import {
  serviceHealth,
  effectiveStatus,
} from "../src/runtime/service-health.ts";
import { effectiveConfig } from "../src/config/effective.ts";
const root = ROOT + "/memory/";
const read = (name) => {
  try {
    return readState(root + name);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};
const service = serviceHealth();
console.log(
  JSON.stringify(
    {
      service,
      configuration: effectiveConfig(),
      schedule: read("schedule.json"),
      execution: effectiveStatus(
        cycleStatus(read("scheduled-cycle.json")),
        service,
      ),
      lastDispatch: read("scheduler-status.json"),
      watchdog: read("watchdog-state.json"),
      quota: read("contact-quota.json"),
    },
    null,
    2,
  ),
);
