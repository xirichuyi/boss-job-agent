import { createHash } from "node:crypto";
import type { Conversation } from "./contracts.ts";

/** Preserve persisted draft keys across the dependency-injection migration. */
export function replyFingerprint(
  history: Conversation,
  profile: string,
  replyPrompt: string,
  commonPrompt: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(history.messages) + profile + replyPrompt + commonPrompt,
    )
    .digest("hex");
}
