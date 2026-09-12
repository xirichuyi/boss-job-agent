import { conversationCompany } from "../../domain/conversation-identity.ts";

// Read the platform's selected contact and loaded conversation independently.
// Recruiter agencies often do not appear anywhere in the visible chat header.
export function conversationIdentityExpression(job): string {
  const expected = JSON.stringify({
    id: job.id,
    recruiter: job.recruiter,
    company: conversationCompany(job),
    title: job.title,
  });
  return `(()=>{const expected=${expected};
    const c=document.querySelector('.chat-conversation');
    const selected=c?.__vue__?.selectedFriend$;
    const loaded=c?.querySelector('.top-info-content')?.__vue__?.conversation$;
    const name=c?.querySelector('.top-info-content .name-text')?.textContent.trim();
    const title=c?.querySelector('.position-name')?.textContent.trim();
    const normalize=t=>typeof t==='string'?t.replace(/（(?:代招|猎头)职位）$/, '').trim():'';
    return !!(expected.id&&expected.recruiter&&expected.company&&expected.title&&
      selected?.encryptJobId===expected.id&&loaded?.encryptJobId===expected.id&&
      selected.encryptBossId&&selected.encryptBossId===loaded.encryptBossId&&
      selected.name===expected.recruiter&&loaded.name===expected.recruiter&&
      selected.brandName===expected.company&&name===expected.recruiter&&
      normalize(title)===normalize(expected.title)&&
      normalize(loaded.jobName)===normalize(expected.title));})()`;
}
