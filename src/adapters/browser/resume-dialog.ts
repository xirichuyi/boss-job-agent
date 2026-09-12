export const visibleResumeDialogExpression = `(()=>{
  const rows=[...document.querySelectorAll('.boss-popup__wrapper.choose-resume-dialog')].filter(e=>{
    const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.checkVisibility({visibilityProperty:true});
  });if(rows.length>1)throw Error('简历弹窗不唯一');return rows[0]||null;
})()`;

// Complete only an already requested, zero-duration close whose native callback
// is stranded. Never dismiss an open dialog or remove DOM behind Vue's back.
export const finishClosingResumeDialogExpression = `(()=>{
  const d=${visibleResumeDialogExpression};
  if(!d)return 'absent';
  const style=getComputedStyle(d);
  const zero=s=>s.split(',').every(t=>parseFloat(t)===0);
  if(!d.classList.contains('v-leave-active')||!d.classList.contains('v-leave')||
     typeof d._leaveCb!=='function'||d._leaveCb.cancelled||
     !zero(style.animationDuration)||!zero(style.transitionDuration)||
     d.getAnimations().some(a=>a.playState==='running'))return 'open';
  d._leaveCb();return 'closed';
})()`;
