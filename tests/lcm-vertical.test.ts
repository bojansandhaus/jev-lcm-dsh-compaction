import test from 'node:test';
import assert from 'node:assert/strict';
import { LcmStore } from '../src/store.js';

test('LCM condenses text while retaining raw messages and committed DAG lineage', () => {
  const store = new LcmStore(':memory:');
  const first = store.ingest('session', 'message:1', { role: 'user', content: 'original request' });
  const second = store.ingest('session', 'message:2', { role: 'assistant', content: 'root cause is configuration drift; delegation abc123def456' });
  const leaf = store.node('session', 'user: original request', [first]);
  const parent = store.node('session', 'assistant: root cause is configuration drift', [second]);
  const nodes = store.nodes('session') as { id: number; depth: number; summary: string }[];
  assert.equal(nodes[0].id, parent);
  assert.equal(nodes[0].depth, 1);
  assert.equal((store.db.prepare('SELECT child FROM edges WHERE parent=?').get(parent) as { child: number }).child, leaf);
  assert.deepEqual(store.expand('session', second)?.raw, { role: 'assistant', content: 'root cause is configuration drift; delegation abc123def456' });
  assert.equal(store.expand('other', second), null);
  assert.ok((store.grep('session', 'abc123def456') as unknown[]).length === 1);
  store.close();
});

test('LCM active context assembles protected verbatim evidence before summaries within budget', () => {
  const store = new LcmStore(':memory:');
  const raw = store.ingest('session', 'tool:1', { role: 'tool', content: 'tool evidence exact-result-789' });
  store.saveHints('session', [{ id: 'anchor-1', kind: 'anchor', action: 'keep', store_id: raw, text: 'delegation abc123def456 must remain verbatim', scores: { anchor_keep: 0.9 } }]);
  const node = store.node('session', 'LCM summary of prior user and assistant text', [raw]);
  store.markNodeCommitted(node, 1, 2);
  const context = store.assemble('session', 2600);
  assert.equal(context[0]?.kind, 'protected');
  assert.match(context[0]?.text ?? '', /delegation abc123def456 must remain verbatim/);
  assert.match(context[0]?.text ?? '', /store_id=/);
  assert.ok(context.reduce((size, item) => size + item.text.length, 0) <= 2600);
  assert.ok(context.some(item => item.kind === 'summary'));
  store.close();
});

test('LCM keeps raw tool evidence recoverable when active context is bounded', () => {
  const store = new LcmStore(':memory:');
  const ids = Array.from({ length: 40 }, (_, i) => store.ingest('session', `tool:${i}`, { result: `unique-evidence-${i}` }));
  const node = store.node('session', 'condensed tool history', ids);
  store.markNodeCommitted(node, 1, 2);
  const context = store.assemble('session', 256);
  assert.ok(context.length > 0);
  assert.deepEqual(store.expand('session', ids[39])?.raw, { result: 'unique-evidence-39' });
  assert.equal((store.grep('session', 'unique-evidence-39') as unknown[]).length, 1);
  store.close();
});

test('protected keep is exact, while truncate uses only configured head and tiny budgets keep pointers', () => {
  const store = new LcmStore(':memory:');
  const long = 'K'.repeat(3000);
  const raw = store.ingest('session', 'anchor:source', { content: long });
  store.saveHints('session', [
    { id: 'keep-long', action: 'keep', store_id: raw, text: long },
    { id: 'truncate-long', action: 'truncate', store_id: raw, text: 'T'.repeat(1000) },
  ]);
  const exact = store.assemble('session', 5000, 17);
  assert.equal(exact.find((entry) => entry.candidate === 'keep-long')?.text.length, 3000 + '[store_id=1; candidate=keep-long]\n'.length);
  assert.match(exact.find((entry) => entry.candidate === 'truncate-long')?.text ?? '', /^\[store_id=.*\]\nT{17}/);
  const tiny = store.assemble('session', 100, 17);
  assert.ok(tiny.some((entry) => entry.kind === 'pointer' && entry.store_id === raw));
  assert.deepEqual(store.expand('session', raw)?.raw, { content: long });
  store.close();
});

test('same-length messages have distinct canonical raw identities and repeated ingest is stable', () => {
  const store = new LcmStore(':memory:');
  const a = store.ingest('session', 'message:0:user:aaa', { role: 'user', content: 'aaaa' });
  const b = store.ingest('session', 'message:1:user:bbb', { role: 'user', content: 'bbbb' });
  assert.notEqual(a, b);
  assert.equal(store.ingest('session', 'message:0:user:aaa', { role: 'user', content: 'aaaa' }), a);
  assert.deepEqual(store.expand('session', b)?.raw, { role: 'user', content: 'bbbb' });
  store.close();
});

test('nodes expose pending, committed, and aborted lifecycle states', () => {
  const store = new LcmStore(':memory:');
  const raw = store.ingest('session', 'message:1', { text: 'x' });
  const pending = store.node('session', 'model summary', [raw]);
  assert.equal((store.nodes('session') as { status: string }[])[0].status, 'pending');
  store.markNodeCommitted(pending, 11, 12);
  assert.equal((store.nodes('session') as { status: string }[])[0].status, 'committed');
  const aborted = store.node('session', 'another', [raw]);
  store.markNodeAborted(aborted);
  assert.equal((store.nodes('session') as { status: string }[])[0].status, 'aborted');
  store.close();
});
