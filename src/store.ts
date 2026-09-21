import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';import { dirname } from 'node:path';
export class LcmStore {
  readonly db:DatabaseSync;
  constructor(path:string){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS raw(id INTEGER PRIMARY KEY,session TEXT NOT NULL,identity TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(session,identity));
    CREATE VIRTUAL TABLE IF NOT EXISTS raw_fts USING fts5(body,content='raw',content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS raw_index AFTER INSERT ON raw BEGIN INSERT INTO raw_fts(rowid,body) VALUES(new.id,new.body); END;
    CREATE TABLE IF NOT EXISTS nodes(id INTEGER PRIMARY KEY,session TEXT NOT NULL,depth INTEGER NOT NULL,summary TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS edges(parent INTEGER NOT NULL REFERENCES nodes(id),child INTEGER NOT NULL REFERENCES nodes(id),UNIQUE(parent,child));
    CREATE TABLE IF NOT EXISTS sources(node INTEGER NOT NULL REFERENCES nodes(id),raw INTEGER NOT NULL REFERENCES raw(id),UNIQUE(node,raw));
    CREATE TABLE IF NOT EXISTS hints(session TEXT NOT NULL,candidate TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(session,candidate));`);}
  ingest(session:string,identity:string,value:unknown):number{
    const body=JSON.stringify(value);const old=this.db.prepare('SELECT id,body FROM raw WHERE session=? AND identity=?').get(session,identity);
    if(old){if(old.body!==body)throw new Error('immutable raw ownership mismatch');return Number(old.id);}
    return Number(this.db.prepare('INSERT INTO raw(session,identity,body) VALUES(?,?,?)').run(session,identity,body).lastInsertRowid);
  }
  grep(session:string,query:string,limit=20){return this.db.prepare('SELECT raw.id,raw.identity,raw.body FROM raw JOIN raw_fts ON raw.id=raw_fts.rowid WHERE raw.session=? AND raw_fts MATCH ? ORDER BY raw.id LIMIT ?').all(session,'"'+query.replaceAll('"','""')+'"',Math.min(100,Math.max(1,limit)));}
  expand(session:string,id:number){const row=this.db.prepare('SELECT id,body FROM raw WHERE session=? AND id=?').get(session,id);return row?{store_id:Number(row.id),raw:JSON.parse(String(row.body))}:null;}
  node(session:string,summary:string,rawIds:number[]):number{
    this.db.exec('BEGIN IMMEDIATE');try{
      const previous=this.db.prepare('SELECT id,depth FROM nodes WHERE session=? ORDER BY id DESC LIMIT 1').get(session);
      const id=Number(this.db.prepare('INSERT INTO nodes(session,depth,summary) VALUES(?,?,?)').run(session,previous?Number(previous.depth)+1:0,summary).lastInsertRowid);
      if(previous)this.db.prepare('INSERT INTO edges(parent,child) VALUES(?,?)').run(id,Number(previous.id));
      const link=this.db.prepare('INSERT OR IGNORE INTO sources(node,raw) VALUES(?,?)');for(const raw of rawIds)link.run(id,raw);
      this.db.exec('COMMIT');return id;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  saveHints(session:string,candidates:unknown[]){const put=this.db.prepare('INSERT OR REPLACE INTO hints(session,candidate,data) VALUES(?,?,?)');for(const item of candidates){const c=item as {id:string};put.run(session,c.id,JSON.stringify(c));}}
  nodes(session:string){return this.db.prepare('SELECT id,depth,summary FROM nodes WHERE session=? ORDER BY id DESC').all(session);}
  close(){this.db.close();}
}
