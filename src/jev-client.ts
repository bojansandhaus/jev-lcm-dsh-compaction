export class ProviderError extends Error {
  constructor(readonly reason:string){super(['transport_error','timeout','401','403','429','5xx','http_error','malformed','disabled','cooldown'].includes(reason)?reason:'transport_error');this.reason=this.message;}
}
export type Questions=Record<string,{type:'noul';instructions:string}>;
export type Scores=Record<string,number>;
export type Transport=(url:string,key:string,payload:unknown,timeout:number)=>Promise<unknown>;
export function parseAnswers(data:unknown,names:string[]):Scores {
  if (!data || typeof data!=='object' || !('answers' in data) || !data.answers || typeof data.answers!=='object') throw new ProviderError('malformed');
  const out:Scores={};
  for(const n of names){const a=(data.answers as Record<string,unknown>)[n]; const v=a && typeof a==='object' && 'noul' in a?a.noul:undefined;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)throw new ProviderError('malformed');out[n]=v;}
  return out;
}
export const post:Transport=async(url,key,payload,timeout)=>{
  try {
    const response=await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeout*1000)});
    if(!response.ok)throw new ProviderError([401,403,429].includes(response.status)?String(response.status):response.status>=500?'5xx':'http_error');
    const text=await response.text();if(text.length>2000000)throw new ProviderError('malformed');
    try{return JSON.parse(text);}catch{throw new ProviderError('malformed');}
  }catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError(error instanceof Error && error.name==='TimeoutError'?'timeout':'transport_error');}
};
