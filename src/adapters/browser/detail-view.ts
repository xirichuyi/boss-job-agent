/** Bind the visible job to its native response, including an agency recruiter. */
export function detailViewExpression(proof, diagnostics = false) {
  return `(()=>{
    const p=${JSON.stringify(proof)}, norm=s=>String(s||'').replace(/\\s+/g,'');
    const d=document.querySelector('.job-detail-box');
    const active=document.querySelector('.job-card-wrap.active .job-name');
    const boss=d?.querySelector('.job-boss-info');
    const recruiter=boss?.querySelector('.name')?.childNodes[0]?.textContent.trim();
    const identity=boss?.querySelector('.boss-info-attr')?.textContent.trim();
    const checks={
      content:!!d&&d.innerText.startsWith(p.title)&&d.innerText.includes('职位描述'),
      job:active?.getAttribute('href')==='/job_detail/'+p.id+'.html',
      recruiter:!!p.recruiter&&recruiter===p.recruiter,
      identity:!!p.identity&&norm(identity)===norm(p.identity)
    };
    if(${JSON.stringify(diagnostics)})return checks;
    if(!Object.values(checks).every(Boolean))return null;
    return {id:p.id,title:p.title,text:d.innerText,proof:p,recruiter,identity,
      buttons:[...d.querySelectorAll('a,button')].filter(e=>/立即沟通|继续沟通/.test(e.textContent)).map(e=>({text:e.textContent.trim(),class:e.className}))};
  })()`;
}
