import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/settings.js';
import { shape,tokens } from '../src/state-shaper.js';

test('CJK state cap preserves candidates or marks them unscored',()=>{const s=settings({max_state_tokens:1000,max_request_tokens:2000});const b=shape([{role:'user',content:'中文'.repeat(10000)}],[],s);assert.ok(tokens(b.state)<=1000);assert.ok(b.tier>=2);});
