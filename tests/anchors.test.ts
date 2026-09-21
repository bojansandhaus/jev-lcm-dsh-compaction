import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/settings.js';
import { extract } from '../src/anchors.js';

test('assistant spans are exact',()=>{const text='We must retain `abc123def456` at v1.2.3.';const spans=extract(text,settings().jev_anchor_patterns);assert.ok(spans.some(s=>s.text==='`abc123def456`'));assert.ok(spans.every(s=>text.slice(s.start,s.end)===s.text));});
