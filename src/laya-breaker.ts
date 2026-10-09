/**
 * Consecutive-failure breaker for the local Laya hop.
 *
 * DOGA v1.3.0 keeps one counter for its local classifier: every local failure
 * increments it, the hosted fallback is allowed while the count is at or below
 * three, and past that the fallback is suppressed until a local evaluation
 * succeeds. This is the same rule for `laya_then_hosted`.
 *
 * A plain counter has no recovery path, though: if Laya never comes back, every
 * later turn re-raises the local error and the hosted API that could still
 * serve is never reached again, for the life of the process. So a tripped
 * breaker also admits one probe per cooldown window — the hosted fallback runs
 * and the counter is NOT incremented, which is what makes it a half-open
 * transition rather than a reset. The counter still only clears on a successful
 * local answer.
 *
 * Scope: the counter lives in this module, so it is per process and resets on
 * restart. The per-provider cooldown cannot express this. A cooldown is a
 * per-chain timer that expires on its own, so a host that keeps failing on
 * every request still receives one remote attempt per cooldown window. The
 * breaker counts the local hop's consecutive health and no successful hosted
 * answer clears it; only a successful local answer does.
 */
export const LAYA_FALLBACK_FAILURE_LIMIT=3;
/**
 * How long a tripped breaker stays open before it admits one probe. The value
 * is deliberately the same order as `jev_fallback_cooldown_s` so a probe is not
 * more often than the chain would retry anyway.
 */
export const LAYA_BREAKER_COOLDOWN_MS=60_000;
let consecutiveFailures=0;
/** When the breaker last tripped or last admitted a probe, in its caller's clock. */
let openedAt=0;
let gate:Promise<unknown>=Promise.resolve();
/**
 * Serialize the read-modify-write of the counter. `score()` is awaitable and
 * two sessions can score concurrently in one process, so the increment and the
 * reset take a queue slot each, the way DOGA holds a failure lock.
 */
function withGate<T>(fn:()=>T):Promise<T>{const next=gate.then(fn);gate=next.then(()=>undefined,()=>undefined);return next;}
/** Consecutive local failures observed in this process. */
export function layaFailureCount():number{return consecutiveFailures;}
/** Whether a tripped breaker has been open long enough to admit one probe. */
export function layaHalfOpen(now:number):boolean{return consecutiveFailures>LAYA_FALLBACK_FAILURE_LIMIT&&now-openedAt>=LAYA_BREAKER_COOLDOWN_MS;}
/**
 * Record a local failure. Resolves false when the hosted fallback must be
 * suppressed. A tripped breaker past its cooldown resolves true without
 * incrementing: that is the one probe its half-open state buys, and it is why
 * `now` comes from the caller's clock rather than from this module.
 */
export function noteLayaFailure(now:number=Date.now()):Promise<boolean>{
  return withGate(()=>{
    if(layaHalfOpen(now)){openedAt=now;return true;}
    consecutiveFailures+=1;
    if(consecutiveFailures>LAYA_FALLBACK_FAILURE_LIMIT)openedAt=now;
    return consecutiveFailures<=LAYA_FALLBACK_FAILURE_LIMIT;
  });
}
/** Record a local success, which clears the breaker. Called on both local routes. */
export function noteLayaSuccess():Promise<void>{return withGate(()=>{consecutiveFailures=0;openedAt=0;});}
/** Forget the count without pretending a call succeeded. Test and operations seam. */
export function resetLayaBreaker():void{consecutiveFailures=0;openedAt=0;}
