export type JevMode = 'auto' | 'typesafe' | 'openrouter' | 'laya' | 'laya_then_hosted';
/**
 * The DOGA v1.3.0 mode names, accepted as aliases for the two values this
 * package already ships. `settings()` resolves them to the canonical value, so
 * an alias never reaches a provider chain, a diagnostic, or a log.
 */
export const MODE_ALIASES:Record<string,JevMode>={laya_local:'laya',laya_with_jev_fallback:'laya_then_hosted'};
export const MODES:JevMode[]=['auto','typesafe','openrouter','laya','laya_then_hosted'];
export type ModeInput=JevMode|'laya_local'|'laya_with_jev_fallback';
/** Canonical mode for a configured value, or undefined when nothing accepts it. */
export function resolveMode(value:unknown):JevMode|undefined {
  const name=typeof value==='string'?value.trim().toLowerCase():'';
  const canonical=MODE_ALIASES[name]??name;
  return (MODES as string[]).includes(canonical)?canonical as JevMode:undefined;
}
export interface Settings {
  jev_provider: JevMode;
  typesafe_base_url: string; openrouter_base_url: string;
  openrouter_endpoint_path: string;
  jev_endpoint_path: string; jev_model: string; openrouter_model: string;
  laya_base_url: string; laya_endpoint_path: string; laya_model: string;
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
  min_result_chars: number; hint_budget_tokens: number; lcm_rollup_fan_in: number;
}
export type ProviderName = 'typesafe' | 'openrouter' | 'laya';
export const defaults: Settings = {
  jev_provider:'auto', typesafe_base_url:'https://api.typesafe.ai/v1',
  openrouter_base_url:'https://openrouter.ai/api', openrouter_endpoint_path:'/alpha/decisions', jev_endpoint_path:'/systemone',
  jev_model:'jev-latest', openrouter_model:'~typesafe/jev-latest',
  laya_base_url:'http://127.0.0.1:8000', laya_endpoint_path:'/v1/systemone', laya_model:'convaiinnovations/laya',
  jev_fallback_enabled:true, jev_fallback_order:['typesafe','openrouter'],
  jev_fallback_on:['transport_error','timeout','401','403','429','5xx'],
  jev_fallback_cooldown_s:60, jev_fallback_max_retries:1, request_timeout_s:30,
  keep_threshold:.15, keep_threshold_max:.40, min_keep_rate:.10,
  jev_calibration_enabled:true, jev_calibration_window:500, jev_calibration_min_samples:50,
  conservative:false, jev_anchor_protection_enabled:true,
  jev_anchor_patterns:[String.raw`\b[a-f0-9]{7,40}\b`,String.raw`\b[A-Z_]{2,}_(?:KEY|TOKEN|SECRET|URL|PATH|ID)\b`,String.raw`[^.!?\n]*(?:root cause|because|constraint|must|never|always)[^.!?\n]*[.!?]?`,String.raw`(?:\bline \d+\b|:\d+:\d+)`,'`[^`\\n]+`',String.raw`["'][^"'\n]*(?:/|\\)[^"'\n]*["']`,String.raw`\b[vV]?\d+\.\d+\.\d+(?:[+.-][\w.]+)?\b`],
  jev_batch_window_turns:3, jev_max_candidates_per_batch:300, jev_urgent_context_ratio:.90,
  max_state_tokens:25000, max_request_tokens:30000, truncate_head_chars:300,
  min_result_chars:8000, hint_budget_tokens:4000, lcm_rollup_fan_in:4,
};
export function endpoint(base:string,path:string):string {
  const decoded=decodeURIComponent(base+path);
  if (/[\\\s\x00-\x1f]/.test(decoded)) throw new Error('invalid provider endpoint');
  const u=new URL(base);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || !path.startsWith('/') || /[?#]/.test(path) || decodeURIComponent(path).includes('..')) throw new Error('invalid provider endpoint');
  if (u.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw new Error('nonlocal provider requires HTTPS');
  return base.replace(/\/$/,'')+path;
}
/** Accepted configuration shape: the canonical modes plus the DOGA mode aliases. */
export type SettingsInput=Partial<Omit<Settings,'jev_provider'>> & {jev_provider?:ModeInput};
export function settings(input:SettingsInput={}):Settings {
  const provider=resolveMode(input.jev_provider??defaults.jev_provider);
  if (!provider) throw new Error('invalid jev_provider: expected auto, typesafe, openrouter, laya, or laya_then_hosted, where laya_local aliases laya and laya_with_jev_fallback aliases laya_then_hosted');
  const s:Settings={...defaults,...input,jev_provider:provider};
  if (!s.jev_fallback_order.length || new Set(s.jev_fallback_order).size!==s.jev_fallback_order.length || s.jev_fallback_order.some(p=>!['typesafe','openrouter'].includes(p))) throw new Error('invalid provider order');
  for (const v of [s.keep_threshold,s.keep_threshold_max,s.min_keep_rate,s.jev_urgent_context_ratio]) if (!Number.isFinite(v) || v<0 || v>1) throw new Error('invalid probability');
  for (const v of [s.jev_calibration_window,s.jev_calibration_min_samples,s.jev_batch_window_turns,s.jev_max_candidates_per_batch,s.max_state_tokens,s.max_request_tokens,s.hint_budget_tokens]) if (!Number.isInteger(v) || v<1) throw new Error('invalid budget');
  if (!Number.isInteger(s.lcm_rollup_fan_in) || s.lcm_rollup_fan_in < 0) throw new Error('invalid rollup fan-in');
  if (s.jev_calibration_min_samples>s.jev_calibration_window || s.max_request_tokens<=s.max_state_tokens || s.request_timeout_s<=0 || s.jev_fallback_cooldown_s<0 || s.jev_fallback_max_retries<0) throw new Error('invalid limits');
  endpoint(s.typesafe_base_url,s.jev_endpoint_path); endpoint(s.openrouter_base_url,'/alpha/decisions'); endpoint(s.laya_base_url,s.laya_endpoint_path);
  s.jev_anchor_patterns.forEach(p=>new RegExp(p,'g'));
  return s;
}
