import { clef_checkpoint } from './clef.js';
export type JevMode = 'api_with_local_fallback' | 'api_only' | 'local_only' | 'local_with_api_fallback';
/**
 * The four canonical modes, from Beau's 2026-10-04 contract.
 *
 * `api_with_local_fallback`  hosted API first, local model behind it
 * `api_only`                hosted API alone, a failure is reported not rerouted
 * `local_only`              local model alone, a failure is reported not rerouted
 * `local_with_api_fallback` local model first, hosted API behind it
 *
 * The mode names which *side* leads and whether the other is a fallback. It does
 * not name which hosted provider: that is `api_provider`, so one mode can reach
 * Jev through TypeSafe, Jev through OpenRouter, or Clef, chosen by configuration.
 * Previously the hosted provider was the mode itself (`typesafe`, `openrouter`,
 * `clef`), which meant a hosted-first-with-local-fallback route had no name.
 */
export const MODES:JevMode[]=['api_with_local_fallback','api_only','local_only','local_with_api_fallback'];
/**
 * Names from earlier releases that must keep resolving, so no deployed
 * configuration breaks. Each entry says what the old mode did.
 *
 * `auto` keeps its own historical meaning rather than the spec's reading of it:
 * it selected among the keyed hosted providers and never picked the keyless
 * local route on its own initiative. It becomes hosted-first with the local
 * model behind it only when a local model is actually configured, so a
 * configuration that relied on `auto` meaning "hosted only" still ends up hosted
 * only. See `resolveMode`'s use in `settings()`.
 */
export const MODE_ALIASES:Record<string,JevMode>={
  // Local, alone.
  laya:'local_only', laya_local:'local_only',
  // Local first, hosted behind it.
  laya_then_hosted:'local_with_api_fallback', laya_with_jev_fallback:'local_with_api_fallback',
  // Hosted alone, resolved by credential exactly as before.
  jev_api:'api_only', clef_api:'api_only',
  // Hosted first with the local model behind it. `clef` pinned Clef and kept
  // `jev_fallback_order` behind it, which is this same shape.
  clef:'api_with_local_fallback', clef_with_local_fallback:'api_with_local_fallback',
  // A pinned hosted provider led its route alone.
  typesafe:'api_only', openrouter:'api_only',
  // `auto` is resolved with knowledge of the environment in `settings()`, not here.
  auto:'api_only'
};
export type ModeInput=JevMode|'laya'|'laya_local'|'laya_then_hosted'|'laya_with_jev_fallback'|'jev_api'|'clef_api'|'clef'|'clef_with_local_fallback'|'typesafe'|'openrouter'|'auto';
/**
 * Canonical mode for a configured value, or undefined when nothing accepts it.
 *
 * `auto` is the one value that cannot resolve from its own text: whether it
 * means "hosted only" or "hosted first, local behind it" depends on whether a
 * local model is configured. `settings()` resolves it with that knowledge.
 */
export function resolveMode(value:unknown):JevMode|undefined {
  const name=typeof value==='string'?value.trim().toLowerCase():'';
  if(name==='auto')return 'api_only';
  const canonical=MODE_ALIASES[name]??name;
  return (MODES as string[]).includes(canonical)?canonical as JevMode:undefined;
}
/** Whether a configured mode name is the one alias that needs the environment to resolve. */
export function isAutoMode(value:unknown):boolean {
  return typeof value==='string'&&value.trim().toLowerCase()==='auto';
}
/**
 * Mode names that used to name the Clef provider outright. They still carry
 * that pin, because a mode no longer says which hosted provider is meant.
 */
const CLEF_NAMED_MODES=new Set(['clef','clef_api','clef_with_local_fallback']);
export interface Settings {
  jev_provider: JevMode;
  /**
   * Which hosted provider the `api_*` modes lead with. `auto` picks the first
   * usable member of `jev_fallback_order`, which is what the old `auto` mode
   * did. Default `auto` keeps a deployment that names no provider on the same
   * routing it had before.
   */
  api_provider: HostedProvider|'auto';
  typesafe_base_url: string; openrouter_base_url: string;
  openrouter_endpoint_path: string;
  jev_endpoint_path: string; jev_model: string; openrouter_model: string;
  laya_base_url: string; laya_endpoint_path: string;
  /**
   * Which local decision model answers. This is the checkpoint or engine name
   * sent to the local server, not a provider name: `laya` is the default, and
   * `kev`, `tev1`, `laya-multilingual`, and the `jeff` family all fit the same
   * `/v1/systemone` contract and work by changing this value alone. It is
   * deliberately not an allowlist, so a newly released local model works without
   * a code change.
   */
  local_model: string;
  /**
   * Superseded by `local_model` and kept so an existing profile still works.
   * `local_model` wins whenever it is set explicitly; this is read only when
   * `local_model` is left at its default and a deployment still sets the old
   * name.
   */
  laya_model: string;
  clef_model: string;
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
export type ProviderName = 'typesafe' | 'openrouter' | 'laya' | 'clef';
/** The hosted side of the `api_*` modes. `laya` is the local side and is never one of these. */
export type HostedProvider = 'typesafe' | 'openrouter' | 'clef';
export const defaults: Settings = {
  jev_provider:'api_only', api_provider:'auto',
  typesafe_base_url:'https://api.typesafe.ai/v1',
  openrouter_base_url:'https://openrouter.ai/api', openrouter_endpoint_path:'/alpha/decisions', jev_endpoint_path:'/systemone',
  jev_model:'jev-latest', openrouter_model:'~typesafe/jev-latest',
  laya_base_url:'http://127.0.0.1:8000', laya_endpoint_path:'/v1/systemone', laya_model:'convaiinnovations/laya',
  local_model:'convaiinnovations/laya',
  clef_model:'clef',
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
export type SettingsInput=Partial<Omit<Settings,'jev_provider'>>&{jev_provider?:ModeInput;api_provider?:HostedProvider|'auto'};
/**
 * Providers `jev_fallback_order` accepts. `laya` is deliberately absent: the
 * local route replaces the hosted pair for a profile rather than joining it,
 * and `laya_then_hosted` is the one mode that puts it in front of them.
 */
export const FALLBACK_MEMBERS:ProviderName[]=['typesafe','openrouter','clef'];
export function settings(input:SettingsInput={}):Settings {
  const configured=input.jev_provider??defaults.jev_provider;
  const provider=resolveMode(configured);
  if (!provider) throw new Error(`invalid jev_provider: expected ${MODES.join(', ')}. Earlier names keep working: ${Object.keys(MODE_ALIASES).sort().join(', ')}`);
  const s:Settings={...defaults,...input,jev_provider:provider};
  // `auto` means the hosted side with the local model behind it when one is
  // configured, and hosted alone when none is. It never picks the keyless local
  // route on its own initiative, which is what the old `auto` mode did not do
  // either, so a profile that relied on it keeps the same routing.
  if (isAutoMode(configured)&&s.jev_provider==='api_only'&&localConfigured(s,input)) s.jev_provider='api_with_local_fallback';
  // `clef` and `clef_api` used to *be* the provider, so they pinned Clef. A mode
  // no longer names a provider, so those two names carry the pin with them,
  // otherwise a profile that configured Clef by mode would silently fall back to
  // whatever `api_provider` says.
  if (configured&&typeof configured==='string'&&CLEF_NAMED_MODES.has(configured.trim().toLowerCase())&&s.api_provider==='auto') s.api_provider='clef';
  if (s.api_provider!=='auto'&&!FALLBACK_MEMBERS.includes(s.api_provider)) throw new Error(`invalid api_provider: expected auto or one of ${FALLBACK_MEMBERS.join(', ')}`);
  if (!s.jev_fallback_order.length || new Set(s.jev_fallback_order).size!==s.jev_fallback_order.length || s.jev_fallback_order.some(p=>!FALLBACK_MEMBERS.includes(p))) throw new Error('invalid provider order');
  for (const v of [s.keep_threshold,s.keep_threshold_max,s.min_keep_rate,s.jev_urgent_context_ratio]) if (!Number.isFinite(v) || v<0 || v>1) throw new Error('invalid probability');
  for (const v of [s.jev_calibration_window,s.jev_calibration_min_samples,s.jev_batch_window_turns,s.jev_max_candidates_per_batch,s.max_state_tokens,s.max_request_tokens,s.hint_budget_tokens]) if (!Number.isInteger(v) || v<1) throw new Error('invalid budget');
  if (!Number.isInteger(s.lcm_rollup_fan_in) || s.lcm_rollup_fan_in < 0) throw new Error('invalid rollup fan-in');
  if (s.jev_calibration_min_samples>s.jev_calibration_window || s.max_request_tokens<=s.max_state_tokens || s.request_timeout_s<=0 || s.jev_fallback_cooldown_s<0 || s.jev_fallback_max_retries<0) throw new Error('invalid limits');
  endpoint(s.typesafe_base_url,s.jev_endpoint_path); endpoint(s.openrouter_base_url,'/alpha/decisions'); endpoint(s.laya_base_url,s.laya_endpoint_path);
  // `local_model` is the checkpoint or engine name, deliberately not an
  // allowlist, so a local model released tomorrow works without a code change.
  // Only an empty value or one that would corrupt a URL path segment or a JSON
  // string is refused.
  const model=String(input.local_model??'').trim();
  if (input.local_model!==undefined&&!model) throw new Error('invalid local_model: must not be empty');
  if (input.local_model!==undefined&&/[^\w.\-/:]/.test(model)) throw new Error('invalid local_model: allowed characters are letters, digits, and . - _ / :');
  // A profile that predates `local_model` may still set `laya_model`; honour it
  // when `local_model` was left at its default.
  s.local_model=input.local_model!==undefined?model:(input.laya_model??defaults.laya_model).trim()||defaults.local_model;
  s.clef_model=clef_checkpoint(s.clef_model);
  s.jev_anchor_patterns.forEach(p=>new RegExp(p,'g'));
  return s;
}
/**
 * Whether a local model is actually configured.
 *
 * The default `laya_base_url` is loopback, which is a placeholder rather than a
 * deployment decision, so its presence alone must not add a local hop to a
 * hosted-only profile. A local model counts as configured only when the profile
 * points it somewhere else, which is the change a deployment makes to opt in.
 */
function localConfigured(s:Settings,input:SettingsInput):boolean {
  if (input.laya_base_url!==undefined)return Boolean(String(input.laya_base_url).trim());
  return String(s.laya_base_url??'').trim()!==defaults.laya_base_url;
}
