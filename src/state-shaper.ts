import { Candidate,Message } from './anchors.js';import { Settings } from './settings.js';import { Questions } from './jev-client.js';import { questions } from './decisions.js';
export function tokens(value:unknown):number{return Buffer.byteLength(JSON.stringify(value),'utf8');}
export function shape(messages:Message[],candidates:Candidate[],s:Settings){
  let history:Message[]=[],tier=0;
  for(tier=0;tier<5;tier+=1){history=structuredClone(messages);for(const m of history){if(tier&&m.role==='tool')m.content=String(m.content).slice(0,[s.truncate_head_chars,50,0,0][tier-1])+' [result omitted; raw evidence retained]';else if(tier>=2)m.content=String(m.content).replace(/\s+/g,' ').slice(0,tier===2?200:60);for(const c of m.tool_calls??[])if(tier)c.function.arguments=c.function.arguments.slice(0,[1000,200,60,30][tier-1]);}if(tokens({history,candidates:[]})<=s.max_state_tokens)break;}
  if(tokens({history,candidates:[]})>s.max_state_tokens){const folded:Message[]=[];for(const m of [...history].reverse()){if(tokens([m,...folded])>s.max_state_tokens/2)break;folded.unshift(m);}history=folded;}
  let state:{history:Message[];candidates:unknown[]}={history,candidates:[]},qs:Questions={};const selected:Candidate[]=[];
  for(const c of candidates.slice(0,s.jev_max_candidates_per_batch)){const trial={history,candidates:[...state.candidates,{id:c.id,kind:c.kind,text:c.text,call:c.call??{}}]},q={...qs,...questions(c)};if(tokens(trial)>s.max_state_tokens||tokens({model:s.openrouter_model,state:trial,questions:q})>s.max_request_tokens)continue;state=trial;qs=q;selected.push(c);}
  return {state,questions:qs,selected,tier:Math.min(tier,4)};
}
