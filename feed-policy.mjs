export function eligible(c) { return c.editorial_marks?.some(m=>m==='加精'||m==='中标'); }
export function selectedAt(c) {
 const timestamp=v=>typeof v==='boolean'?0:(Number.isFinite(Number(v))&&Number(v)>0?Number(v):0);
 return Math.max(timestamp(c.digested_at),timestamp(c.win_bid_at),timestamp(c.editorial_marks_raw?.digested),timestamp(c.editorial_marks_raw?.win_bid));
}
export function rankUnseen(cards,user) {
 const done=new Set(user.consumed||[]), weights=new Map();
 for(const [ids,n] of [[user.favorites||[],2],[user.feedback?.liked||[],3],[user.feedback?.not_interested||[],-4]])
  for(const id of ids) for(const t of (cards.find(c=>c.article_id===id)?.tags||[])) weights.set(t,(weights.get(t)||0)+n);
 return cards.map((c,i)=>({c,i,score:(c.tags||[]).reduce((s,t)=>s+(weights.get(t)||0),0)}))
  .filter(x=>eligible(x.c)&&!done.has(x.c.article_id)).sort((a,b)=>selectedAt(b.c)-selectedAt(a.c)||b.score-a.score||b.i-a.i).map(x=>x.i);
}
