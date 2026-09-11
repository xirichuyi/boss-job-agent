import { stopAll } from "./inbox-retry.ts";
import { executionConfig } from "../runtime/coordinator.ts";
// Retry only this read operation, with the adapter's identity checks intact.
export async function readHistory(
  chat,
  job,
  { deadline = Infinity, onRetry = (_error: any) => {} } = {},
) {
  try {
    return await chat.openConversation(job);
  } catch (error) {
    if (
      stopAll(error) ||
      Date.now() + executionConfig().inboxRetry.readRetryMinRemainingMs >=
        deadline ||
      !/页面内容未就绪|CONTACT_LOOKUP_FAILED/.test(error.message)
    )
      throw error;
    onRetry(error);
    return chat.openConversation(job);
  }
}
