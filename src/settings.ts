export interface Settings {
  jev_provider: 'auto' | 'typesafe' | 'openrouter';
  typesafe_base_url: string; openrouter_base_url: string;
  jev_endpoint_path: string; jev_model: string; openrouter_model: string;
  jev_fallback_enabled: boolean; jev_fallback_order: ProviderName[];
  jev_fallback_on: string[]; jev_fallback_cooldown_s: number;
  jev_fallback_max_retries: number; request_timeout_s: number;
  keep_threshold: number; keep_threshold_max: number; min_keep_rate: number;
  jev_calibration_enabled: boolean; jev_calibration_window: number;
  jev_calibration_min_samples: number; conservative: boolean;
  jev_anchor_protection_enabled: boolean; jev_anchor_patterns: string[];
  jev_batch_window_turns: number; jev_max_candidates_per_batch: number;
  jev_urgent_context_ratio: number; max_state_tokens: number;
  max_request_tokens: number; truncate_head_chars: number;
  min_result_chars: number; hint_budget_tokens: number;
}
export type ProviderName = 'typesafe' | 'openrouter';
export const defaults: Settings = {
  jev_provider:'auto', typesafe_base_url:'https://api.typesafe.ai/v1',
  openrouter_base_url:'https://openrouter.ai/api', jev_endpoint_path:'/systemone',
  jev_model:'jev-latest', openrouter_model:'~typesafe/jev-latest',
  jev_fallback_enabled:true, jev_fallback_order:['typesafe','openrouter'],
  jev_fallback_on:['transport_error','timeout','401','403','429','5xx'],
  jev_fallback_cooldown_s:60, jev_fallback_max_retries:1, request_timeout_s:30,
  keep_threshold:.15, keep_threshold_max:.40, min_keep_rate:.10,
  jev_calibration_enabled:true, jev_calibration_window:500, jev_calibration_min_samples:50,
  conservative:false, jev_anchor_protection_enabled:true,
  jev_anchor_patterns:[String.raw`\b[a-f0-9]{7,40}\b`,String.raw`\b[A-Z_]{2,}_(?:KEY|TOKEN|SECRET|URL|PATH|ID)\b`,String.raw`[^.!?\n]*(?:root cause|because|constraint|must|never|always)[^.!?\n]*[.!?]?`,String.raw`(?:\bline \d+\b|:\d+:\d+)`,'`[^`\\n]+`',String.raw`["'][^"'\n]*(?:/|\\)[^"'\n]*["']`,String.raw`\b[vV]?\d+\.\d+\.\d+(?:[+.-][\w.]+)?\b`],
  jev_batch_window_turns:3, jev_max_candidates_per_batch:300, jev_urgent_context_ratio:.90,
  max_state_tokens:25000, max_request_tokens:30000, truncate_head_chars:300,
  min_result_chars:8000, hint_budget_tokens:4000,
};
export function endpoint(base:string,path:string):string {
  const decoded=decodeURIComponent(base+path);
  if (/[\\\s\x00-\x1f]/.test(decoded)) throw new Error('invalid provider endpoint');
  const u=new URL(base);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || !path.startsWith('/') || /[?#]/.test(path) || decodeURIComponent(path).includes('..')) throw new Error('invalid provider endpoint');
  if (u.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw new Error('nonlocal provider requires HTTPS');
  return base.replace(/\/$/,'')+path;
}
export function settings(input:Partial<Settings>={}):Settings {
  const s={...defaults,...input};
  if (!['auto','typesafe','openrouter'].includes(s.jev_provider)) throw new Error('invalid jev_provider');
  if (!s.jev_fallback_order.length || new Set(s.jev_fallback_order).size!==s.jev_fallback_order.length || s.jev_fallback_order.some(p=>!['typesafe','openrouter'].includes(p))) throw new Error('invalid provider order');
  for (const v of [s.keep_threshold,s.keep_threshold_max,s.min_keep_rate,s.jev_urgent_context_ratio]) if (!Number.isFinite(v) || v<0 || v>1) throw new Error('invalid probability');
  for (const v of [s.jev_calibration_window,s.jev_calibration_min_samples,s.jev_batch_window_turns,s.jev_max_candidates_per_batch,s.max_state_tokens,s.max_request_tokens,s.hint_budget_tokens]) if (!Number.isInteger(v) || v<1) throw new Error('invalid budget');
  if (s.jev_calibration_min_samples>s.jev_calibration_window || s.max_request_tokens<=s.max_state_tokens || s.request_timeout_s<=0 || s.jev_fallback_cooldown_s<0 || s.jev_fallback_max_retries<0) throw new Error('invalid limits');
  endpoint(s.typesafe_base_url,s.jev_endpoint_path); endpoint(s.openrouter_base_url,'/alpha/decisions');
  s.jev_anchor_patterns.forEach(p=>new RegExp(p,'g'));
  return s;
}
