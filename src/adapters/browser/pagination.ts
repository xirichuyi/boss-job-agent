export const jobIdsExpression = `[...document.querySelectorAll('.job-card-wrap .job-name')].map(e=>e.getAttribute('href')).filter(Boolean)`;
export const advanceJobsExpression = `(()=>{
  const card=document.querySelector('.job-card-wrap');
  if(!card)return 'missing_list';
  for(let e=card.parentElement;e;e=e.parentElement){
    if(/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+2&&e.scrollTop+e.clientHeight<e.scrollHeight-2){
      e.scrollTop=e.scrollHeight;return 'container_scroll';
    }
  }
  const next=[...document.querySelectorAll('button,a')].filter(e=>
    e.getBoundingClientRect().width>0&&/^(下一页|下一頁)$/.test(e.textContent.trim())&&
    !e.disabled&&e.getAttribute('aria-disabled')!=='true'&&
    !/disabled/.test(e.className));
  if(next.length===1){next[0].click();return 'next_page';}
  const e=document.scrollingElement;
  if(e&&e.scrollHeight>e.clientHeight+2){window.scrollTo(0,e.scrollHeight);return 'window_scroll';}
  return 'no_control';
})()`;
export function hasNewIds(before, after) {
  const seen = new Set(before);
  return after.some((id) => id && !seen.has(id));
}
