import test from 'node:test';
import assert from 'node:assert/strict';
import { settings,endpoint } from '../src/settings.js';
import { parseAnswers } from '../src/jev-client.js';

test('malformed payloads and unsafe endpoints are rejected',()=>{for(const data of [null,{}, {answers:{x:{noul:true}}},{answers:{x:{noul:2}}}])assert.throws(()=>parseAnswers(data,['x']),/malformed/);assert.throws(()=>endpoint('https://api.typesafe.ai/v1'+String.fromCharCode(92),'/systemone'));assert.throws(()=>endpoint('https://example.test','/%2e%2e/x'));})
