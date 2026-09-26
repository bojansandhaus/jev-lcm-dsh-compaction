/**
 * Consecutive-failure breaker for the local Laya hop.
 *
 * DOGA v1.3.0 keeps one counter for its local classifier: every local failure
 * increments it, the hosted fallback is allowed while the count is at or below
 * three, and past that the fallback is suppressed until a local evaluation
 * succeeds. This is the same rule for `laya_then_hosted`.
 *
 * Scope: the counter lives in this module, so it is per process and resets on
 * restart. The per-provider cooldown cannot express this. A cooldown is a
 * per-chain timer that expires on its own, so a host that keeps failing on
 * every request still receives one remote attempt per cooldown window. The
 * breaker counts the local hop's consecutive health and no successful hosted
 * answer clears it; only a successful local answer does.
 */
export const LAYA_FALLBACK_FAILURE_LIMIT=3;
let consecutiveFailures=0;
let gate:Promise<unknown>=Promise.resolve();
/**
 * Serialize the read-modify-write of the counter. `score()` is awaitable and
 * two sessions can score concurrently in one process, so the increment and the
 * reset take a queue slot each, the way DOGA holds a failure lock.
 */
function withGate<T>(fn:()=>T):Promise<T>{const next=gate.then(fn);gate=next.then(()=>undefined,()=>undefined);return next;}
/** Consecutive local failures observed in this process. */
export function layaFailureCount():number{return consecutiveFailures;}
/** Record a local failure. Resolves false when the hosted fallback must be suppressed. */
export function noteLayaFailure():Promise<boolean>{return withGate(()=>{consecutiveFailures+=1;return consecutiveFailures<=LAYA_FALLBACK_FAILURE_LIMIT;});}
/** Record a local success, which clears the breaker. Called on both local routes. */
export function noteLayaSuccess():Promise<void>{return withGate(()=>{consecutiveFailures=0;});}
/** Forget the count without pretending a call succeeded. Test and operations seam. */
export function resetLayaBreaker():void{consecutiveFailures=0;}
