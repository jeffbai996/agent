import {sortConversations} from "../public/conversation-order.js";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export class Store {
  constructor(path) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,upstream TEXT,title TEXT NOT NULL,created INTEGER NOT NULL,snapshot TEXT);
    CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,owner TEXT NOT NULL,conversation TEXT NOT NULL REFERENCES conversations(id),text TEXT NOT NULL,state TEXT NOT NULL,result TEXT,created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS requests_conversation ON requests(conversation,created);
    CREATE TABLE IF NOT EXISTS app_preferences(owner TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(owner,kind,id));
    CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, key TEXT NOT NULL, conversation TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(owner,key));
    CREATE INDEX IF NOT EXISTS events_owner ON events(owner,seq);
    CREATE TABLE IF NOT EXISTS observations(conversation TEXT PRIMARY KEY, owner TEXT NOT NULL, until INTEGER NOT NULL, observed INTEGER NOT NULL DEFAULT 0);`);
    // A delivery interrupted by a restart is uncertain: it is never resent, and
    // the owner is told once. The gateway turns this list into events.
    this.recovered = this.db
      .prepare("SELECT id,owner,conversation,created FROM requests WHERE state='sending'")
      .all();
    this.db.exec("UPDATE requests SET state='unknown' WHERE state='sending'");
    try {
      this.db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(owner UNINDEXED, conversation UNINDEXED, ref UNINDEXED, kind UNINDEXED, title, text, updated UNINDEXED)",
      );
      this.fts = true;
    } catch {
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS search_index(owner TEXT, conversation TEXT, ref TEXT, kind TEXT, title TEXT, text TEXT, updated REAL)",
      );
      this.fts = false;
    }
  }
  close() {
    this.db.close();
  }
  list(owner) {
    const rows=this.db.prepare(`
      SELECT c.id,c.title,c.created,c.upstream IS NOT NULL AS ready,
        MAX(c.created,COALESCE(r.latest,0),COALESCE(e.latest,0)) AS activity
      FROM conversations c
      LEFT JOIN (SELECT conversation,MAX(created) AS latest FROM requests WHERE owner=? GROUP BY conversation) r ON r.conversation=c.id
      LEFT JOIN (SELECT conversation,MAX(CAST(json_extract(body,'$.time') AS REAL)*1000) AS latest FROM events WHERE owner=? AND kind='reply' GROUP BY conversation) e ON e.conversation=c.id
      WHERE c.owner=?
    `).all(owner,owner,owner).map(row=>({...row,...this.preference(owner,'chat',row.id)}));
    return sortConversations(rows,this.preference(owner,'conversation-order','current'));
  }
  preference(owner, kind, id) {
    const row = this.db
      .prepare(
        "SELECT body FROM app_preferences WHERE owner=? AND kind=? AND id=?",
      )
      .get(owner, kind, id);
    return row ? JSON.parse(row.body) : {};
  }
  prefer(owner, kind, id, value) {
    this.db
      .prepare("INSERT OR REPLACE INTO app_preferences VALUES(?,?,?,?)")
      .run(owner, kind, id, JSON.stringify(value));
    return value;
  }
  preferences(owner, kind) {
    return this.db
      .prepare(
        "SELECT id,body FROM app_preferences WHERE owner=? AND kind=? ORDER BY rowid DESC LIMIT 200",
      )
      .all(owner, kind)
      .map((row) => ({ id: row.id, ...JSON.parse(row.body) }));
  }
  numberMemories(owner) {
    const rows=this.db.prepare("SELECT id,body FROM app_preferences WHERE owner=? AND kind='memory' ORDER BY rowid").all(owner);
    let items=rows.map(row=>({id:row.id,...JSON.parse(row.body)}));
    if(!items.some(item=>!Number.isSafeInteger(item.number)))return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      items=this.db.prepare("SELECT id,body FROM app_preferences WHERE owner=? AND kind='memory' ORDER BY rowid").all(owner).map(row=>({id:row.id,...JSON.parse(row.body)}));
      let number=Math.max(this.preference(owner,'memory-sequence','current').value||0,...items.map(item=>item.number||0));
      for(const item of items)if(!Number.isSafeInteger(item.number))this.prefer(owner,'memory',item.id,{...item,number:++number});
      this.prefer(owner,'memory-sequence','current',{value:number});
      this.db.exec('COMMIT');
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  memoryList(owner) {
    this.numberMemories(owner);
    return {
      ok: true,
      items: this.db
        .prepare(
          "SELECT id,body FROM app_preferences WHERE owner=? AND kind='memory' ORDER BY rowid DESC LIMIT 200",
        )
        .all(owner)
        .map((row) => ({ id: row.id, ...JSON.parse(row.body) })),
    };
  }
  memoryReceipts(owner,conversation) {
    return this.db.prepare("SELECT id,body FROM app_preferences WHERE owner=? AND kind='memory-receipt' AND json_extract(body,'$.conversation')=? ORDER BY rowid LIMIT 200").all(owner,conversation).map(row=>({id:row.id,...JSON.parse(row.body)}));
  }
  memorySave(owner, data) {
    this.numberMemories(owner);
    const receipt = this.preference(owner, "memory-op", data.requestId);
    if (receipt.ok) return receipt;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let out;
      if (data.id) {
        const id = String(data.id);
        const existing = this.db
          .prepare(
            "SELECT body FROM app_preferences WHERE owner=? AND kind='memory' AND id=?",
          )
          .get(owner, id);
        if (!existing)
          throw Object.assign(Error("Memory not found."), { status: 404 });
        const current = JSON.parse(existing.body);
        if (
          data.version !== undefined &&
          Number(data.version) !== Number(current.version)
        )
          throw Object.assign(
            Error("This memory was updated elsewhere. Refresh and try again."),
            { status: 409 },
          );
        if (data.forget) {
          this.db
            .prepare(
              "DELETE FROM app_preferences WHERE owner=? AND kind='memory' AND id=?",
            )
            .run(owner, id);
          out = { ok: true, id, deleted: true };
        } else {
          const item = {
            id,
            number:current.number,
            text: data.text,
            version: (Number(current.version) || 1) + 1,
            updated: Date.now(),
          };
          this.prefer(owner, "memory", id, item);
          out = { ok: true, item };
        }
      } else {
        const id = randomUUID();
        const number=(this.preference(owner,'memory-sequence','current').value||0)+1;
        this.prefer(owner,'memory-sequence','current',{value:number});
        const item = { id, number, text: data.text, version: 1, updated: Date.now() };
        this.prefer(owner, "memory", id, item);
        out = { ok: true, item };
      }
      this.prefer(owner, "memory-op", data.requestId, out);
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  rename(owner, id, title) {
    this.db
      .prepare("UPDATE conversations SET title=? WHERE owner=? AND id=?")
      .run(title, owner, id);
  }
  get(owner, id) {
    return this.db
      .prepare("SELECT * FROM conversations WHERE id=? AND owner=?")
      .get(id, owner);
  }
  add(owner, id, title) {
    this.db
      .prepare(
        "INSERT INTO conversations(id,owner,title,created) VALUES(?,?,?,?)",
      )
      .run(id, owner, title, Date.now());
  }
  remove(owner, id) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.get(owner, id)) throw Error("Conversation not found.");
      this.db.prepare("DELETE FROM requests WHERE conversation=?").run(id);
      this.db
        .prepare(
          "DELETE FROM app_preferences WHERE owner=? AND (id=? OR substr(id,1,?)=?)",
        )
        .run(owner, id, id.length + 1, id + ":");
      this.db
        .prepare(
          "DELETE FROM app_preferences WHERE owner=? AND (json_extract(body,'$.conversation')=? OR json_extract(body,'$.targetConversation')=?) AND (kind!='schedule' OR json_extract(body,'$.state')!='running' OR json_extract(body,'$.targetConversation')=?)",
        )
        .run(owner, id, id, id);
      this.db.prepare("DELETE FROM events WHERE owner=? AND conversation=?").run(owner, id);
      this.db.prepare("DELETE FROM observations WHERE conversation=?").run(id);
      this.db.prepare("DELETE FROM search_index WHERE owner=? AND conversation=?").run(owner, id);
      this.db
        .prepare("DELETE FROM conversations WHERE id=? AND owner=?")
        .run(id, owner);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  accountForUpstream(upstream) {
    const accounts=this.db.prepare('SELECT id,owner FROM conversations WHERE upstream=?').all(upstream);
    return accounts.length===1 ? accounts[0] : null;
  }
  link(id, upstream) {
    this.db
      .prepare("UPDATE conversations SET upstream=? WHERE id=?")
      .run(upstream, id);
  }
  cache(id, value) {
    this.db
      .prepare("UPDATE conversations SET snapshot=? WHERE id=?")
      .run(JSON.stringify(value), id);
  }
  request(id) {
    return this.db.prepare("SELECT * FROM requests WHERE id=?").get(id);
  }
  requests(id) {
    return this.db
      .prepare(
        "SELECT id,text,state,result,created FROM requests WHERE conversation=? ORDER BY created,rowid",
      )
      .all(id)
      .map((r) => ({ ...r, result: r.result ? JSON.parse(r.result) : null }));
  }
  accept(owner, cid, id, text) {
    this.db
      .prepare(
        "INSERT INTO requests(id,owner,conversation,text,state,created) VALUES(?,?,?,?,'sending',?)",
      )
      .run(id, owner, cid, text, Date.now());
  }
  settle(id, state, result) {
    this.db
      .prepare("UPDATE requests SET state=?,result=? WHERE id=?")
      .run(state, JSON.stringify(result), id);
    return { id, state, ...result };
  }
  // Event log: one row per observed fact, ordered by insertion, replayable from a cursor.
  emit(owner, event) {
    const { key, kind, conversation } = event;
    if (!key || !kind || !conversation) throw Error("Invalid event.");
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO events(owner,key,conversation,kind,body,created) VALUES(?,?,?,?,?,?)",
      )
      .run(owner, key, conversation, kind, JSON.stringify(event), Date.now());
    if (!result.changes) return null;
    return { seq: Number(result.lastInsertRowid), ...event };
  }
  events(owner, { after = 0, limit = 200 } = {}) {
    return this.db
      .prepare(
        "SELECT seq,body FROM events WHERE owner=? AND seq>? ORDER BY seq LIMIT ?",
      )
      .all(owner, after, Math.min(500, Math.max(1, limit)))
      .map((row) => ({ seq: row.seq, ...JSON.parse(row.body) }));
  }
  recent(owner, limit = 200) {
    return this.db
      .prepare("SELECT seq,body FROM events WHERE owner=? ORDER BY seq DESC LIMIT ?")
      .all(owner, limit)
      .map((row) => ({ seq: row.seq, ...JSON.parse(row.body) }));
  }
  floor(owner) {
    return this.db.prepare("SELECT MIN(seq) AS seq FROM events WHERE owner=?").get(owner).seq || 0;
  }
  latest(owner) {
    return this.db.prepare("SELECT MAX(seq) AS seq FROM events WHERE owner=?").get(owner).seq || 0;
  }
  pruneEvents(owner, keep = 2000) {
    this.db
      .prepare(
        "DELETE FROM events WHERE owner=? AND seq NOT IN (SELECT seq FROM events WHERE owner=? ORDER BY seq DESC LIMIT ?)",
      )
      .run(owner, owner, keep);
  }
  // Observation schedule for the background observer.
  watch(owner, conversation, until) {
    this.db
      .prepare(
        "INSERT INTO observations(conversation,owner,until,observed) VALUES(?,?,?,0) ON CONFLICT(conversation) DO UPDATE SET until=MAX(until,excluded.until)",
      )
      .run(conversation, owner, until);
  }
  unwatch(conversation) {
    this.db.prepare("DELETE FROM observations WHERE conversation=?").run(conversation);
  }
  observed(conversation, now) {
    this.db.prepare("UPDATE observations SET observed=? WHERE conversation=?").run(now, conversation);
  }
  due(now, limit = 3) {
    return this.db
      .prepare("SELECT owner,conversation FROM observations WHERE until>? ORDER BY observed LIMIT ?")
      .all(now, limit);
  }
  watchRecent(now, window, duration) {
    for (const row of this.db
      .prepare(
        "SELECT DISTINCT c.owner,c.id FROM conversations c JOIN requests r ON r.conversation=c.id WHERE c.upstream IS NOT NULL AND r.created>?",
      )
      .all(now - window))
      this.watch(row.owner, row.id, now + duration);
  }
  // Full-text index over every observed conversation. Rows are replaced per conversation.
  index(owner, conversation, rows) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM search_index WHERE owner=? AND conversation=?").run(owner, conversation);
      const insert = this.db.prepare("INSERT INTO search_index(owner,conversation,ref,kind,title,text,updated) VALUES(?,?,?,?,?,?,?)");
      for (const row of rows) insert.run(owner, conversation, String(row.ref), row.kind, row.title || "", row.text || "", row.updated || 0);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  search(owner, query, { offset = 0, limit = 20 } = {}) {
    const terms = String(query || "").replace(/["*()]/g, " ").split(/\s+/).filter(Boolean).slice(0, 12);
    if (!terms.length) return { items: [], next: null };
    const page = Math.min(50, Math.max(1, limit)), skip = Math.max(0, offset);
    let rows;
    if (this.fts) {
      const match = terms.map((term, i) => `"${term}"${i === terms.length - 1 ? "*" : ""}`).join(" ");
      rows = this.db
        .prepare(
          "SELECT s.conversation,s.ref,s.kind,s.title,snippet(search_index,5,'','','…',14) AS snippet,s.updated,c.title AS conversationTitle FROM search_index s JOIN conversations c ON c.id=s.conversation AND c.owner=s.owner WHERE s.owner=? AND search_index MATCH ? ORDER BY rank, s.updated DESC LIMIT ? OFFSET ?",
        )
        .all(owner, match, page + 1, skip);
    } else {
      const clauses = terms.map(() => "(s.title LIKE ? OR s.text LIKE ?)").join(" AND ");
      rows = this.db
        .prepare(
          `SELECT s.conversation,s.ref,s.kind,s.title,substr(s.text,1,120) AS snippet,s.updated,c.title AS conversationTitle FROM search_index s JOIN conversations c ON c.id=s.conversation AND c.owner=s.owner WHERE s.owner=? AND ${clauses} ORDER BY s.updated DESC LIMIT ? OFFSET ?`,
        )
        .all(owner, ...terms.flatMap((t) => [`%${t}%`, `%${t}%`]), page + 1, skip);
    }
    const items = rows.slice(0, page).map((row) => ({ ...row, snippet: (row.snippet || "").slice(0, 240) }));
    return { items, next: rows.length > page ? skip + page : null };
  }
}
