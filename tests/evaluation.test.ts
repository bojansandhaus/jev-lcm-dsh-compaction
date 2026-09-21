import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from '../evaluation/run_eval.js';
test('actual host compaction preserves raw retrieval in both arms',async()=>{
 for(const protect of [false,true]){
  const result=await evaluate(protect);
  assert.equal(result.raw_retrieval_retention,1);
  assert.ok(result.input_tokens>result.budget_tokens);
  assert.ok(result.active_tokens<=result.budget_tokens);
  assert.ok(result.model_calls>0);
  assert.equal(result.production_comparison,false);
 }
});
test('retention responds to actual model transport content',async()=>{
 const dropped=await evaluate(false);
 const kept=await evaluate(false,10000,'Synthetic summary preserves deadbeef1234567.');
 assert.equal(dropped.exact_evidence_retention,0);
 assert.equal(kept.exact_evidence_retention,1);
});
test('invalid and nonconvergent budgets are rejected',async()=>{
 await assert.rejects(()=>evaluate(true,0),/invalid budget/);
 await assert.rejects(()=>evaluate(true,1),/nonconvergence/);
});
