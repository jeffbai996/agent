import { randomUUID } from "node:crypto";
import { failure, text } from "./errors.mjs";

// Schedules are app-owned definitions. They never enter the execution owner's
// cron list; each occurrence is dispatched as an ordinary request in a fresh
// conversation that carries the usual approval requirements.
const LATE = 600000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RUNS_KEPT = 20;
function parts(timeZone, t) {
  const format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const o = Object.fromEntries(format.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: DAYS.indexOf(o.weekday) };
}
export function validateRepeat(repeat) {
  if (repeat === undefined || repeat === null) return null;
  if (!repeat || typeof repeat !== "object" || !["day", "weekday", "week"].includes(repeat.every))
    throw failure("Choose daily, weekday or weekly repeats.");
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(repeat.time || ""));
  if (!match) throw failure("Choose a time of day.");
  const out = { every: repeat.every, time: match[0] };
  if (repeat.every === "week") {
    if (!Number.isInteger(repeat.weekday) || repeat.weekday < 0 || repeat.weekday > 6) throw failure("Choose a weekday.");
    out.weekday = repeat.weekday;
  }
  return out;
}
// The next instant strictly after `after` that matches the repeat in its time zone.
export function nextOccurrence(after, repeat, timeZone) {
  const [h, m] = repeat.time.split(":").map(Number);
  const instant = (y, mo, d) => {
    const wanted = Date.UTC(y, mo - 1, d, h, m);
    let guess = wanted;
    for (let i = 0; i < 3; i++) {
      const p = parts(timeZone, guess);
      guess += wanted - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    }
    return guess;
  };
  const start = parts(timeZone, after);
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + i));
    const wd = day.getUTCDay();
    if (repeat.every === "weekday" && (wd === 0 || wd === 6)) continue;
    if (repeat.every === "week" && wd !== repeat.weekday) continue;
    const t = instant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
    if (t > after) return t;
  }
  throw failure("Choose a valid repeat.");
}
export class Schedules {
  constructor(gateway, { clock = Date.now, notify = async () => {} } = {}) {
    this.g = gateway;
    this.clock = clock;
    this.notify = notify;
    this.busy = false;
    for (const row of this.rows())
      if (row.value.state === "claiming")
        this.put(row.owner, { ...row.value, state: "unknown" });
  }
  rows() {
    return this.g.store.db
      .prepare(
        "SELECT owner,body FROM app_preferences WHERE kind='schedule' ORDER BY rowid",
      )
      .all()
      .map((r) => ({ owner: r.owner, value: JSON.parse(r.body) }));
  }
  list(owner) {
    return this.g.store
      .preferences(owner, "schedule")
      .sort((a, b) => a.dueAt - b.dueAt);
  }
  put(owner, value) {
    return this.g.store.prefer(owner, "schedule", value.id, value);
  }
  save(owner, data) {
    this.g.ready(owner, data.conversation);
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(data.id || ""))
      throw failure("Invalid schedule.");
    if (
      !["reminder", "task"].includes(data.kind) ||
      typeof data.enabled !== "boolean"
    )
      throw failure("Choose a reminder or a task.");
    if (typeof data.timeZone !== "string")
      throw failure("Choose a valid time zone.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: data.timeZone }).format();
    } catch {
      throw failure("Choose a valid time zone.");
    }
    const repeat = validateRepeat(data.repeat);
    let dueAt = data.dueAt;
    if (repeat) dueAt = nextOccurrence(this.clock(), repeat, data.timeZone);
    else if (
      !Number.isSafeInteger(dueAt) ||
      dueAt <= this.clock() ||
      dueAt > this.clock() + 366 * 86400000
    )
      throw failure("Choose a future time within one year.");
    const maxRuns = repeat ? Math.min(365, Math.max(0, Number.isInteger(data.maxRuns) ? data.maxRuns : 0)) : 1;
    const value = {
      id: data.id,
      conversation: data.conversation,
      title: text(data.title, 120),
      text: text(data.text, 3000),
      kind: data.kind,
      dueAt,
      timeZone: data.timeZone,
      repeat,
      enabled: data.enabled,
      state: data.enabled ? "scheduled" : "paused",
      version: 1,
      maxRuns,
      missed: "skip",
      maxElapsedMs: 900000,
      runs: [],
      created: this.clock(),
    };
    if (!value.title || !value.text)
      throw failure("Add a title and instructions.");
    const old = this.list(owner).find((x) => x.id === data.id);
    if (old) {
      if (
        ["title", "text", "kind", "timeZone", "conversation"].some((k) => old[k] !== value[k]) ||
        JSON.stringify(old.repeat || null) !== JSON.stringify(value.repeat) ||
        (!repeat && old.dueAt !== value.dueAt)
      )
        throw failure("This schedule ID already has different content.", 409);
      return old;
    }
    if (
      this.list(owner).filter((x) =>
        ["scheduled", "paused", "running", "claiming"].includes(x.state),
      ).length >= 50
    )
      throw failure("Keep up to 50 active schedules.", 409);
    return this.put(owner, value);
  }
  update(owner, id, action) {
    const old = this.list(owner).find((x) => x.id === id);
    if (!old) throw failure("Schedule not found.", 404);
    if (
      !["pause", "resume", "cancel"].includes(action) ||
      !["scheduled", "paused"].includes(old.state)
    )
      throw failure("This schedule cannot be changed.", 409);
    let dueAt = old.dueAt;
    if (action === "resume") {
      if (old.repeat) dueAt = nextOccurrence(this.clock(), old.repeat, old.timeZone);
      else if (old.dueAt <= this.clock()) throw failure("The scheduled time has passed.", 409);
    }
    return this.put(owner, {
      ...old,
      dueAt,
      state: { pause: "paused", resume: "scheduled", cancel: "canceled" }[
        action
      ],
      enabled: action === "resume",
      version: old.version + 1,
    });
  }
  async event(owner, schedule, detail, conversation = schedule.targetConversation || schedule.conversation) {
    await this.g.emit(owner, {
      key: `${conversation}:schedule:${schedule.id}:${schedule.dueAt}:${detail}`,
      kind: "schedule",
      conversation,
      title: schedule.title,
      detail,
      time: this.clock() / 1000,
      schedule: schedule.id,
    });
    await this.notify(owner, { id: `${conversation}:schedule:${schedule.id}:${schedule.dueAt}:${detail}`, conversation, title: schedule.title, detail, time: this.clock() / 1000 });
  }
  // Record an occurrence's outcome, then either schedule the next one or finish the series.
  advance(owner, s, run) {
    const runs = [...(s.runs || []), run].slice(-RUNS_KEPT);
    const completed = runs.filter((r) => r.state !== "missed" && r.state !== "skipped").length;
    if (!s.repeat || s.state === "canceled" || (s.maxRuns && completed >= s.maxRuns))
      return this.put(owner, { ...s, runs, state: s.repeat ? "done" : run.state, enabled: false });
    const skipped = [];
    let next = nextOccurrence(s.dueAt, s.repeat, s.timeZone);
    while (next <= this.clock()) {
      skipped.push({ at: next, state: "skipped" });
      next = nextOccurrence(next, s.repeat, s.timeZone);
    }
    return this.put(owner, { ...s, runs: [...runs, ...skipped].slice(-RUNS_KEPT), dueAt: next, state: "scheduled", enabled: true, targetConversation: undefined, runStarted: undefined, runId: undefined, firedAt: undefined, receipt: undefined, outcome: undefined });
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Bound each pass; due reminders are inexpensive and remain durable across service stops.
      const rows = this.rows()
        .filter(
          (r) =>
            r.value.state === "running" ||
            (r.value.enabled &&
              r.value.state === "scheduled" &&
              r.value.dueAt <= this.clock()),
        )
        .sort(
          (a, b) =>
            (a.value.state === "running"
              ? a.value.lastObserved || 0
              : a.value.dueAt - 1e15) -
            (b.value.state === "running"
              ? b.value.lastObserved || 0
              : b.value.dueAt - 1e15),
        )
        .slice(0, 10);
      for (const { owner, value: s } of rows) {
        if (s.state === "running") {
          await this.monitor(owner, s);
          continue;
        }
        if (s.kind === "task" && this.clock() - s.dueAt > LATE) {
          // Missed-run policy: a late occurrence is recorded, never run late.
          await this.event(owner, s, "Scheduled time missed", s.conversation);
          this.advance(owner, { ...s, state: "missed" }, { at: s.dueAt, state: "missed" });
          continue;
        }
        this.put(owner, { ...s, state: "claiming", firedAt: this.clock() });
        try {
          this.g.ready(owner, s.conversation);
          if (s.kind === "reminder") {
            await this.event(owner, s, "Reminder", s.conversation);
            this.advance(owner, { ...s, state: "done", firedAt: this.clock() }, { at: s.dueAt, state: "done" });
          } else {
            // Fresh conversation avoids inheriting an earlier run or its permission grants.
            const cid = "scheduled_" + randomUUID();
            const claimed = {
              ...s,
              state: "claiming",
              firedAt: this.clock(),
              targetConversation: cid,
            };
            this.put(owner, claimed);
            await this.g.create(owner, cid, s.title, this.g.store.preference(owner,'chat-agent',s.conversation).id||'primary');
            this.g.store.prefer(owner, "chat", cid, { schedule: s.id });
            const result = await this.g.send(
              owner,
              cid,
              "schedule_" + s.id + (s.repeat ? "_" + s.dueAt : ""),
              s.text +
                "\n\nScheduled request. Complete within 15 minutes. Request approval before purchases, messages, or other external changes. Prior conversation approvals do not apply.",
            );
            const state =
              result.state === "accepted"
                ? "running"
                : result.state === "failed"
                  ? "failed"
                  : "unknown";
            this.put(owner, {
              ...claimed,
              state,
              enabled: state === "running" ? claimed.enabled : false,
              receipt: result.state,
              runId: result.run_id || null,
            });
            await this.event(
              owner,
              { ...s, targetConversation: cid },
              state === "running"
                ? "Scheduled task started"
                : "Check scheduled task",
            );
            if (state !== "running") this.advance(owner, { ...claimed, state }, { at: s.dueAt, state, conversation: cid });
          }
        } catch {
          const current = this.list(owner).find((x) => x.id === s.id);
          this.put(owner, { ...current, state: "unknown", enabled: false });
          await this.event(owner, s, "Check scheduled task");
        }
      }
    } finally {
      this.busy = false;
    }
  }
  async monitor(owner, s) {
    s = { ...s, lastObserved: this.clock() };
    this.put(owner, s);
    try {
      const snap = await this.g.snapshot(owner, s.targetConversation);
      if (snap.stale) return;
      const agent = snap.agent;
      if (
        !agent.alive &&
        ["done", "error", "stopped", "interrupted"].includes(agent.state)
      ) {
        const state = agent.state === "done" ? "done" : "failed";
        await this.event(
          owner,
          s,
          agent.state === "done" ? "Response ready" : "Check scheduled task",
        );
        this.advance(owner, { ...s, state, outcome: agent.state }, { at: s.dueAt, state, conversation: s.targetConversation, outcome: agent.state });
        return;
      }
      if (agent.alive && !s.runStarted) {
        this.put(owner, {
          ...s,
          runStarted: agent.started_ts,
          runId: agent.run_id || s.runId,
        });
        return;
      }
      if (this.clock() - s.firedAt >= s.maxElapsedMs) {
        // Never stop a replacement run the user started in the same conversation.
        if (
          agent.alive &&
          s.runStarted === agent.started_ts &&
          (!s.runId || s.runId === agent.run_id)
        )
          await this.g.stop(owner, s.targetConversation, {
            started: s.runStarted,
            runId: s.runId,
          });
        await this.event(owner, s, "Scheduled task time limit reached");
        this.advance(owner, { ...s, state: "expired" }, { at: s.dueAt, state: "expired", conversation: s.targetConversation });
      }
    } catch {
      /* Backend outages preserve state for the next bounded observation. */
    }
  }
}
