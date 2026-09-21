import test from 'node:test';
import assert from 'node:assert/strict';
import { LcmStore } from '../src/store.js';

test('SQLite raw ownership and DAG links survive reopen',()=>{const db=new LcmStore(':memory:');const id=db.ingest('s','m1',{content:'exact'});assert.equal(db.ingest('s','m1',{content:'exact'}),id);assert.throws(()=>db.ingest('s','m1',{content:'changed'}),/ownership/);const a=db.node('s','leaf',[id]);const b=db.node('s','parent',[id]);assert.equal(db.nodes('s')[0].depth,1);assert.deepEqual(db.expand('s',id)?.raw,{content:'exact'});assert.equal(db.expand('other',id),null);assert.ok(db.db.prepare('SELECT * FROM edges WHERE parent=? AND child=?').get(b,a));db.close();});
