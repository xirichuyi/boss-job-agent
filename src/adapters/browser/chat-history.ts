// One message representation for pre-send snapshots and receipt reconciliation.
export const chatHistoryExpression = `[...(document.querySelector('.chat-conversation')?.querySelectorAll('.message-item')||[])].map(e=>({text:e.innerText,self:e.classList.contains('item-myself'),system:e.classList.contains('item-system'),id:e.getAttribute('data-mid')}))`;
