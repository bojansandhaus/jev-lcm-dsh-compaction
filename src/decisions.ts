import { Candidate } from './anchors.js';import { Questions,Scores } from './jev-client.js';
export function questions(c:Candidate):Questions {
  const entries=c.kind==='anchor'?{anchor_keep:'Does this span contain an identifier, decision, or constraint a future turn is likely to need verbatim?',recovery:'Would re-reading this span be necessary if replaced by a raw-store pointer?'}:{keep_call:'Does this tool call still matter for continuing the current task?',keep_result:'Is the exact tool result likely to be needed verbatim to continue the task?'};
  return Object.fromEntries(Object.entries(entries).map(([name,instructions])=>[c.id+':'+name,{type:'noul',instructions:instructions+' Candidate id: '+c.id}]));
}
export function decide(c:Candidate,scores:Scores,threshold:number,floor=false):void {
  const names=c.kind==='anchor'?['anchor_keep','recovery']:['keep_call','keep_result'];c.scores=Object.fromEntries(names.map(n=>[n,scores[c.id+':'+n]]));c.jev_unscored=false;
  c.action=c.kind==='anchor'?(c.scores.anchor_keep>=threshold||floor?'keep':'drop'):(c.scores.keep_result>=threshold||floor?'keep':c.scores.keep_call>=threshold?'truncate':'drop');
}
