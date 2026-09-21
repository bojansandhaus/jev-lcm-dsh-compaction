import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface LcmContextEntry { kind: 'summary' | 'protected' | 'pointer'; text: string; node_id?: number; store_id?: number; candidate?: string; }

function bounded(text: string, chars: number): string { return text.length <= chars ? text : `${text.slice(0, Math.max(0, chars - 32))}\n[… context budget …]`; }

/** LCM-owned durable raw log, summary DAG, protected index, and recall surface. */
export class LcmStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS raw(id INTEGER PRIMARY KEY,session TEXT NOT NULL,identity TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(session,identity));
      CREATE VIRTUAL TABLE IF NOT EXISTS raw_fts USING fts5(body,content='raw',content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS raw_index AFTER INSERT ON raw BEGIN INSERT INTO raw_fts(rowid,body) VALUES(new.id,new.body); END;
      CREATE TABLE IF NOT EXISTS nodes(id INTEGER PRIMARY KEY,session TEXT NOT NULL,depth INTEGER NOT NULL,summary TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',host_summary_seq INTEGER,host_end_seq INTEGER,created_at INTEGER NOT NULL DEFAULT (unixepoch()));
      CREATE TABLE IF NOT EXISTS edges(parent INTEGER NOT NULL REFERENCES nodes(id),child INTEGER NOT NULL REFERENCES nodes(id),UNIQUE(parent,child));
      CREATE TABLE IF NOT EXISTS sources(node INTEGER NOT NULL REFERENCES nodes(id),raw INTEGER NOT NULL REFERENCES raw(id),UNIQUE(node,raw));
      CREATE TABLE IF NOT EXISTS hints(session TEXT NOT NULL,candidate TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(session,candidate));`);
    for (const column of ["status TEXT NOT NULL DEFAULT 'pending'", 'host_summary_seq INTEGER', 'host_end_seq INTEGER']) {
      try { this.db.exec(`ALTER TABLE nodes ADD COLUMN ${column}`); } catch { /* existing schema already contains this column */ }
    }
    // A process can die after durable LCM preparation but before the host
    // replacement. Such nodes are never valid context on the next open.
    this.db.prepare("UPDATE nodes SET status='aborted' WHERE status='pending'").run();
  }
  ingest(session: string, identity: string, value: unknown): number {
    const body = JSON.stringify(value);
    const old = this.db.prepare('SELECT id,body FROM raw WHERE session=? AND identity=?').get(session, identity) as { id: number; body: string } | undefined;
    if (old) { if (old.body !== body) throw new Error('immutable raw ownership mismatch'); return Number(old.id); }
    return Number(this.db.prepare('INSERT INTO raw(session,identity,body) VALUES(?,?,?)').run(session, identity, body).lastInsertRowid);
  }
  grep(session: string, query: string, limit = 20): unknown[] {
    if (!query.trim()) return [];
    return this.db.prepare('SELECT raw.id,raw.identity,raw.body FROM raw JOIN raw_fts ON raw.id=raw_fts.rowid WHERE raw.session=? AND raw_fts MATCH ? ORDER BY raw.id LIMIT ?').all(session, `"${query.replaceAll('"', '""')}"`, Math.min(100, Math.max(1, limit)));
  }
  expand(session: string, id: number): { store_id: number; raw: unknown } | null {
    const row = this.db.prepare('SELECT id,body FROM raw WHERE session=? AND id=?').get(session, id) as { id: number; body: string } | undefined;
    return row ? { store_id: Number(row.id), raw: JSON.parse(row.body) } : null;
  }
  /**
   * `linkPrevious` chains this summary to the previous attempt and raises its depth.
   * Pass `false` for sibling layer-zero leaves that a later rollup will condense.
   */
  node(session: string, summary: string, rawIds: number[], protectedCandidates: string[] = [], linkPrevious = true): number {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT id,depth FROM nodes WHERE session=? ORDER BY id DESC LIMIT 1').get(session) as { id: number; depth: number } | undefined;
      const chained = linkPrevious ? previous : undefined;
      const id = Number(this.db.prepare('INSERT INTO nodes(session,depth,summary) VALUES(?,?,?)').run(session, chained ? Number(chained.depth) + 1 : 0, summary).lastInsertRowid);
      if (chained) this.db.prepare('INSERT INTO edges(parent,child) VALUES(?,?)').run(id, Number(chained.id));
      const link = this.db.prepare('INSERT OR IGNORE INTO sources(node,raw) VALUES(?,?)');
      for (const raw of rawIds) link.run(id, raw);
      if (protectedCandidates.length) this.db.prepare('DELETE FROM hints WHERE session=? AND candidate NOT IN (' + protectedCandidates.map(() => '?').join(',') + ')').run(session, ...protectedCandidates);
      this.db.exec('COMMIT');
      return id;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** Nodes that no other node summarises, oldest first, limited to `limit`. */
  topLayer(session: string, limit: number): { id: number; depth: number; summary: string }[] {
    const rows = this.db.prepare("SELECT id,depth,summary FROM nodes WHERE session=? AND status='committed'").all(session) as { id: number; depth: number; summary: string }[];
    const children = new Set((this.db.prepare('SELECT child FROM edges').all() as { child: number }[]).map((row) => Number(row.child)));
    return rows.filter((row) => !children.has(Number(row.id))).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, Math.max(0, limit));
  }
  private descendants(id: number): number[] {
    const out: number[] = []; const queue = [id];
    const childOf = this.db.prepare('SELECT child FROM edges WHERE parent=?');
    while (queue.length) {
      const parent = queue.pop() as number;
      for (const row of childOf.all(parent) as { child: number }[]) { const child = Number(row.child); out.push(child); queue.push(child); }
    }
    return out;
  }
  /** Condense committed child summaries into one higher-depth node (multi-layer rollup). */
  rollup(session: string, summary: string, childIds: number[]): number {
    if (childIds.length < 2) throw new Error('rollup requires at least two children');
    const read = this.db.prepare('SELECT id,depth,session FROM nodes WHERE id=?');
    let depth = 0;
    for (const id of childIds) {
      const row = read.get(id) as { id: number; depth: number; session: string } | undefined;
      if (!row || row.session !== session) throw new Error('rollup child missing or out of session');
      depth = Math.max(depth, Number(row.depth) + 1);
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const id = Number(this.db.prepare('INSERT INTO nodes(session,depth,summary) VALUES(?,?,?)').run(session, depth, summary).lastInsertRowid);
      const link = this.db.prepare('INSERT OR IGNORE INTO edges(parent,child) VALUES(?,?)');
      for (const child of childIds) link.run(id, child);
      this.db.exec('COMMIT');
      return id;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  markNodeCommitted(id: number, hostSummarySeq?: number, hostEndSeq?: number): void {
    this.db.prepare('UPDATE nodes SET status=?,host_summary_seq=?,host_end_seq=? WHERE id=?').run('committed', hostSummarySeq ?? null, hostEndSeq ?? null, id);
  }
  markNodeAborted(id: number): void { this.db.prepare('UPDATE nodes SET status=? WHERE id=? AND status=?').run('aborted', id, 'pending'); }
  saveHints(session: string, candidates: unknown[]): void {
    const put = this.db.prepare('INSERT OR REPLACE INTO hints(session,candidate,data) VALUES(?,?,?)');
    for (const item of candidates) { const value = item as { id: string }; put.run(session, value.id, JSON.stringify(value)); }
  }
  nodes(session: string): unknown[] { return this.db.prepare('SELECT id,depth,summary,status,host_summary_seq,host_end_seq FROM nodes WHERE session=? ORDER BY depth DESC,id DESC').all(session); }
  /** Assemble bounded active context from summaries plus protected verbatim evidence. */
  assemble(session: string, budgetChars = 12000, truncateHeadChars = 300, preparedNode?: number): LcmContextEntry[] {
    let remaining = Math.max(0, budgetChars);
    const result: LcmContextEntry[] = [];
    const hints = this.db.prepare('SELECT candidate,data FROM hints WHERE session=? ORDER BY candidate').all(session) as { candidate: string; data: string }[];
    for (const hint of hints) {
      const data = JSON.parse(hint.data) as { action?: string; text?: string; store_id?: number; call?: unknown };
      if (!['keep', 'truncate'].includes(String(data.action))) continue;
      const original = data.call ? `${JSON.stringify(data.call)}\n${data.text ?? ''}` : data.text ?? '';
      const body = data.action === 'truncate' ? original.slice(0, truncateHeadChars) + (original.length > truncateHeadChars ? ' [truncated; expand raw evidence]' : '') : original;
      const exact = `[store_id=${data.store_id ?? 'unknown'}; candidate=${hint.candidate}]\n${body}`;
      if (exact.length <= remaining) {
        result.push({ kind: 'protected', text: exact, store_id: data.store_id, candidate: hint.candidate }); remaining -= exact.length;
      } else {
        const pointer = `[store_id=${data.store_id ?? 'unknown'}; candidate=${hint.candidate}; body=raw]`;
        if (pointer.length <= remaining) { result.push({ kind: 'pointer', text: pointer, store_id: data.store_id, candidate: hint.candidate }); remaining -= pointer.length; }
      }
    }
    // A compaction attempt assembles only its new region summary. Normal recall
    // excludes pending/aborted attempts and may traverse committed layers.
    const rows = (preparedNode === undefined
      ? this.db.prepare("SELECT id,summary FROM nodes WHERE session=? AND status='committed' ORDER BY depth DESC,id DESC").all(session)
      : this.db.prepare("SELECT id,summary FROM nodes WHERE session=? AND id=? AND status='pending'").all(session,preparedNode)) as { id: number; summary: string }[];
    const suppressed = new Set<number>();
    for (const row of rows) {
      if (remaining <= 0) break;
      if (suppressed.has(Number(row.id))) continue;
      const text = bounded(`[node_id=${row.id}]\n${row.summary}`, remaining);
      if (!text) break;
      result.push({ kind: 'summary', text, node_id: Number(row.id) }); remaining -= text.length;
      // A higher-layer summary replaces the layer it condenses; children stay recallable.
      for (const child of this.descendants(Number(row.id))) suppressed.add(child);
    }
    return result;
  }
  close(): void { this.db.close(); }
}
