import test from 'node:test';
import assert from 'node:assert/strict';
import { settings,endpoint } from '../src/settings.js';
import { parseAnswers } from '../src/jev-client.js';

test('a payload with no answers mapping is rejected',()=>{for(const data of [null,{},'text',42,{answers:null},{answers:'x'},{answers:42}])assert.throws(()=>parseAnswers(data,['x']),/malformed/);assert.throws(()=>endpoint('https://api.typesafe.ai/v1'+String.fromCharCode(92),'/systemone'));assert.throws(()=>endpoint('https://example.test','/%2e%2e/x'));})

test('one malformed answer no longer discards the rest of the batch',()=>{
  // The payload is readable, so nothing throws: the well-formed ids come back
  // scored and the malformed ones come back named beside them, instead of the
  // first bad row discarding every score in a batch of up to 300.
  const parsed=parseAnswers({answers:{good:{noul:.5},low:{noul:-1},off:{noul:2},missing:undefined}},['good','low','off','missing']);
  assert.deepEqual(parsed.scores,{good:.5});
  assert.deepEqual(parsed.malformedIds.sort(),['low','missing','off']);
  // A wholly unreadable answer set names every id and scores none; the chain
  // above this still rejects it, because there is nothing left to rank on.
  assert.deepEqual(parseAnswers({answers:{x:{noul:true}}},['x']),{scores:{},malformedIds:['x']});
  assert.deepEqual(parseAnswers({answers:{}},[]).scores,{});
  // A `choice` answer with no distribution, and a `score` answer out of its
  // declared scale, are malformed like any other and reported per id.
  assert.deepEqual(parseAnswers({answers:{x:{choice:'a'}}},['x'],{x:{type:'choice',instructions:'k',criteria:{a:'a'}}}).malformedIds,['x']);
  assert.deepEqual(parseAnswers({answers:{x:{score:9}}},['x'],{x:{type:'score',instructions:'k',criteria:['a','b']}}),{scores:{},malformedIds:['x']});
});
