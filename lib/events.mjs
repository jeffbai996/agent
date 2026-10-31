import {resultOutcome} from '../public/result-versions.js';
// Events are derived from recorded snapshots, never from model prose. Each key
// names one observable fact (a run that ended, a proposal that changed state, a
// file that appeared), so observing the same fact twice records nothing new.
const userApprovals = (snapshot) =>
  (snapshot?.workspace?.jobs || []).flatMap((job) =>
    (job.approvals || []).filter((a) => a.source === "user"),
  );
const resolution = {
  approved: "Decision recorded",
  declined: "Declined",
  expired: "Expired without a decision",
  superseded: "Replaced by a newer proposal",
  changes_requested: "Changes requested",
};
const ending = {
  error: ["run.failed", "Could not finish"],
  interrupted: ["run.interrupted", "Interrupted"],
  stopped: ["run.stopped", "Stopped"],
};
export function deriveEvents(old, snapshot) {
  const out = [], seen = new Set();
  const cid = snapshot.id, title = snapshot.title || "";
  const add = (event) => {
    if (seen.has(event.key)) return;
    seen.add(event.key);
    out.push({ conversation: cid, title, ...event });
  };
  const turns = snapshot.turns || [], agent = snapshot.agent || {};
  for (const turn of turns)
    if (turn.final)
      add({ key: `${cid}:run:${turn.started_ts}`, kind: "reply", detail: "Response ready", time: turn.ended_ts || turn.started_ts, run: turn.started_ts });
  if (agent.final && !agent.alive && agent.started_ts && !turns.some((t) => Math.abs(t.started_ts - agent.started_ts) < 0.01))
    add({ key: `${cid}:run:${agent.started_ts}`, kind: "reply", detail: "Response ready", time: agent.ended_ts || agent.started_ts, run: agent.started_ts });
  for (const job of snapshot.workspace?.jobs || [])
    for (const result of job.results || [])
      add({ key: `${cid}:result:${result.id || result.title}`, kind: "result", title: result.title || title, detail: result.status === "confirmed" ? (resultOutcome(result) === "done" ? "Done" : "Confirmed") : "Result ready", time: result.created || agent.ended_ts || 0, run: result.run_id || "" });
  const before = new Map(userApprovals(old).map((a) => [a.id + ":" + a.fingerprint, a]));
  for (const a of userApprovals(snapshot)) {
    const base = `${cid}:approval:${a.id}:${a.fingerprint}`;
    if (a.status === "pending")
      add({ key: base, kind: "approval.pending", title: a.action?.destination || title, detail: "Needs your decision", time: a.created || 0, run: a.run_id || "", approval: a.id });
    else if (before.get(a.id + ":" + a.fingerprint)?.status === "pending")
      add({ key: `${base}:${a.status}`, kind: "approval.resolved", status: a.status, title: a.action?.destination || title, detail: resolution[a.status] || "No longer waiting", time: a.decided || agent.ended_ts || 0, run: a.run_id || "", approval: a.id });
  }
  const known = new Set((old?.workspace?.files || []).map((f) => f.id));
  for (const file of snapshot.workspace?.files || [])
    if (file.source && file.source !== "upload" && !known.has(file.id))
      add({ key: `${cid}:file:${file.id}`, kind: "file", title: file.name, detail: "File ready", time: file.created || agent.ended_ts || 0, run: agent.started_ts || 0 });
  if (agent.started_ts && !agent.alive && ending[agent.state]) {
    const [kind, detail] = ending[agent.state];
    const error = (agent.messages || []).filter((m) => m.role === "error").at(-1)?.text;
    add({ key: `${cid}:ended:${agent.started_ts}:${agent.state}`, kind, detail, reason: error || "", time: agent.ended_ts || agent.started_ts, run: agent.started_ts });
  }
  if (agent.handoff && agent.started_ts)
    add({ key: `${cid}:handoff:${agent.started_ts}`, kind: "handoff", detail: agent.handoff.reason || "Needs your help", time: agent.handoff.ts || agent.started_ts, run: agent.started_ts });
  return out;
}
const LIMIT = 20000;
export function indexEntries(snapshot) {
  const cid = snapshot.id, agent = snapshot.agent || {};
  const updated = Math.max(agent.ended_ts || 0, agent.started_ts || 0, ...(snapshot.turns || []).map((t) => t.ended_ts || t.started_ts || 0)) || 0;
  const rows = [];
  const text = [
    ...(snapshot.requests || []).filter((r) => !r.id.startsWith("approval-")).map((r) => r.text),
    ...(snapshot.turns || []).map((t) => t.final),
    agent.final,
  ].filter(Boolean).join("\n");
  rows.push({ ref: cid, kind: "conversation", title: snapshot.title || "", text: text.slice(0, LIMIT), updated });
  for (const job of snapshot.workspace?.jobs || [])
    for (const result of job.results || [])
      rows.push({ ref: result.id || result.title, kind: "result", title: result.title || "", text: (result.summary || "").slice(0, LIMIT), updated: result.created || updated });
  for (const file of snapshot.workspace?.files || [])
    rows.push({ ref: file.id, kind: "file", title: file.name, text: "", updated: file.created || updated });
  for (const object of snapshot.objects || [])
    if (!object.archived)
      rows.push({ ref: object.id, kind: object.kind, title: object.title || "", text: [object.description, object.prompt, ...(object.rows || []).map((r) => (r.cells || []).join(" "))].filter(Boolean).join("\n").slice(0, LIMIT), updated: object.updated || updated });
  return rows;
}
// Live delivery to open streams. The log is the record; a stream is a courtesy.
export class EventHub {
  constructor({ keepAlive = 25000, perOwner = 8 } = {}) {
    this.streams = new Map();
    this.perOwner = perOwner;
    this.timer = setInterval(() => {
      for (const set of this.streams.values()) for (const res of set) res.write(": ping\n\n");
    }, keepAlive);
    this.timer.unref?.();
  }
  static frame(event) {
    return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
  }
  subscribe(owner, res) {
    const set = this.streams.get(owner) || new Set();
    this.streams.set(owner, set);
    if (set.size >= this.perOwner) {
      const oldest = set.values().next().value;
      oldest.write("event: replaced\ndata: {}\n\n");
      oldest.end();
      set.delete(oldest);
    }
    set.add(res);
    res.on("close", () => {
      set.delete(res);
      if (!set.size) this.streams.delete(owner);
    });
  }
  publish(owner, event) {
    for (const res of this.streams.get(owner) || []) res.write(EventHub.frame(event));
  }
  close() {
    clearInterval(this.timer);
    for (const set of this.streams.values()) for (const res of set) res.end();
    this.streams.clear();
  }
}
