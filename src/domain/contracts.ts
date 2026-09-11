/** Platform ingestion retains legacy extra fields; write states have explicit contracts. */
export interface PlatformRecord {
  [key: string]: any;
}
export interface ChatMessage {
  id?: string;
  text: string;
  self: boolean;
  system?: boolean;
}
export interface Conversation {
  text?: string;
  messages: ChatMessage[];
}
export interface Job extends PlatformRecord {
  id: string;
  company: string;
  title?: string;
  recruiter?: string;
  salary?: string;
}
export interface SendIntent extends PlatformRecord {
  kind: string;
  jobId: string;
  status:
    | "prepared"
    | "outcome_unknown"
    | "delivered"
    | "platform_greeting_delivered"
    | "cancelled";
}
export interface Contact extends PlatformRecord {
  job: Job;
  status: string;
  cycle?: string;
  intent?: SendIntent;
  replyDraft?: ReplyDraft;
  inboxRetry?: InboxRetry;
}
export interface ReplyDraft {
  historyHash: string;
  decision: Decision;
  createdAt: string;
}
export interface InboxRetry {
  attempts: number;
  reason: string;
  nextAt: string;
  needsAttention: boolean;
}
export interface CycleReport extends PlatformRecord {
  id: string;
  status: string;
  jobReviews: Job[];
  intents: SendIntent[];
  receipts: PlatformRecord[];
  result: {
    newContacts: number;
    messagesSent: number;
    repliesSent: number;
    attachmentsSent: number;
  };
}
export interface Decision {
  action: "contact" | "reply" | "skip";
  message: string;
  reason?: string;
  retryable?: boolean;
}
export interface ChatPort {
  openConversation(job: Job): Promise<Conversation>;
  sendText(
    job: Job,
    message: string,
    history: Conversation,
    beforeSend: () => void,
  ): Promise<PlatformRecord>;
  sendResume(
    job: Job,
    file: string,
    history: Conversation,
    beforeSend: () => void,
  ): Promise<PlatformRecord>;
}
export interface InboxContactContext {
  root: string;
  services: InboxServices;
  report: CycleReport;
  chat: ChatPort;
  decide: (job: Job, history: Conversation, mode: "reply") => Promise<Decision>;
  progress: (phase: string, details: PlatformRecord) => void;
  save: () => void;
  assertAuthority: () => void;
}
export interface InboxServices {
  resumeFile: string;
  now: () => number;
  rejectJob: (job: Job) => string | null | undefined;
  fingerprint: (history: Conversation) => string;
  alert: (alert: { kind: string; contact: string; reason?: string }) => void;
}
