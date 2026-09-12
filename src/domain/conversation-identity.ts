/** Employer dedup stays on job.company; chat headers may show a recruiting agency. */
export function conversationCompany(job): string {
  const proof = job.proof;
  if (!proof?.id || !proof.recruiter) return job.company;
  if (proof.id !== job.id || proof.recruiter !== job.recruiter)
    throw Error("会话岗位身份与原生证据不一致");
  const company =
    proof.recruiterCompany ||
    (typeof proof.identity === "string" &&
    proof.identity.split(" · ").length === 2
      ? proof.identity.split(" · ")[0].trim()
      : null);
  return company && company !== "undefined" ? company : job.company;
}
