import fs from "node:fs";
import { AGENT } from "../config/agent.ts";
import { rejectJobFilters } from "../config/job-filters.ts";
import { replyFingerprint } from "../domain/reply-fingerprint.ts";
import type { InboxServices } from "../domain/contracts.ts";
import { raiseAlert } from "../storage/alerts.ts";
import { profileContext } from "../adapters/model/context.ts";

/** Bind deployment-specific resources without caching editable profile/prompts. */
export function createInboxServices(root: string): InboxServices {
  return {
    resumeFile: AGENT.resumeFile,
    now: Date.now,
    rejectJob: rejectJobFilters,
    alert: (alert) => {
      raiseAlert(root, alert);
    },
    fingerprint: (history) =>
      replyFingerprint(
        history,
        fs.readFileSync(root + "/candidate-profile.md", "utf8"),
        fs.readFileSync(
          new URL("../../prompts/reply.md", import.meta.url),
          "utf8",
        ),
        fs.readFileSync(
          new URL("../../prompts/common.md", import.meta.url),
          "utf8",
        ),
        JSON.stringify(profileContext(root)),
      ),
  };
}
