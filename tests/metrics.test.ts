import test from 'node:test';
import assert from 'node:assert/strict';
import { Metrics } from '../src/metrics.js';

test('low freed warnings are emitted once per three cycles',()=>{const logs:string[]=[];const m=new Metrics(s=>logs.push(s));for(let i=0;i<3;i+=1)m.compaction(100,90,1,30);assert.equal(logs.length,1);assert.equal(m.values.lcm_recall_at_budget,null);});
