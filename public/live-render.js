import {terminalCard, terminalRun, showTerminal} from './terminal-view.js';
import {latestResults,resultOutcome} from './result-versions.js';
import {entryImageIds,mediaStrip} from './result-media.js';
import {actionIcon,actionText} from './activity-icons.js';
import {formatFileSize,attachmentPreview,messageAttachments,isImage} from './attachments.js';
import {resultLayout} from './result-layouts.js';
import { cleanTitle } from './conversation-title.js';
import { drivingResult, travelMode } from './route-result.js';
import { browserCard, browserLocation, latestBrowserRun, isBrowserAction } from "./browser-view.js";
import { profileName, avatarMarkup } from "./profile.js";
import { richText } from "./rich-text.js";
import { t, statusLabel, getLanguage } from "./i18n.js";
import { escape as e, icon, siteBadge } from "./components.js";
export { icon, siteBadge };
export function visibleApprovals(s, approvals = null) {
  const list = approvals || (s?.workspace?.jobs || []).flatMap((j) => j.approvals || []);
  const allUser = (s?.workspace?.jobs || [])
    .flatMap((j) => j.approvals || [])
    .filter((a) => a.source === "user" || !a.source);
  const latestApprovalTs = Math.max(0, ...allUser.map((a) => a.created || 0));
  const lastUserReqTs = Math.max(
    0,
    ...(s?.requests || [])
      .filter((r) => !String(r.id || "").startsWith("approval-"))
      .map((r) => (r.created || 0) / 1000),
  );
  const running = !s?.stale && Boolean(s?.agent?.alive || s?.agent?.state === "running");
  const runStartedTs = s?.agent?.started_ts || 0;
  return list.filter((a) => {
    if (a.source && a.source !== "user") return false;
    if (a.status === "superseded") return false;
    const created = a.created || 0;
    const steeredPast =
      created > 0 &&
      (lastUserReqTs > created + 0.5 ||
        (running && runStartedTs > created + 0.5) ||
        latestApprovalTs > created + 0.5);
    if (steeredPast && a.status !== "approved") return false;
    return true;
  });
}
export function runMayBeActive(snapshot) {
  return snapshot?.availability !== 'missing' && Boolean(snapshot?.agent?.alive || snapshot?.agent?.state === 'running' || snapshot?.agent?.waiting);
}
export function agentStatusStale(snapshot) {
  return Boolean(snapshot?.agentStale ?? snapshot?.stale);
}
export function status(snapshot) {
  if (!snapshot) return t("Ready");
  if (snapshot.availability === 'missing') return t('Conversation unavailable');
  if (agentStatusStale(snapshot)) return t(runMayBeActive(snapshot) ? "Reconnecting…" : "Connection interrupted");
  if (snapshot.agent.waiting && !snapshot.agent.alive) return t(snapshot.agent.waiting.paused ? "Paused for you" : snapshot.agent.waiting.condition ? "Waiting for update" : "Waiting");
  if (snapshot.agent.handoff) return t("Needs your help");
  const alive = snapshot.agent.alive || snapshot.agent.state === "running";
  if (snapshot.control?.stop?.state === "pending" && alive) return t("Stopping…");
  if (snapshot.control?.stop?.state === "confirmed" && !alive && (snapshot.agent.state === "interrupted" || snapshot.control.stop.waiting)) return t("Stopped");
  if (snapshot.control?.takeover?.state === "pending" && alive) return t("Pausing for you");
  if (snapshot.control?.takeover?.state === "ready" && !alive) return t("Paused for you");
  if (visibleApprovals(snapshot).some((a) => a.status === "pending"))
    return t("Needs your decision");
  if (snapshot.agent.alive || snapshot.agent.state === "running")
    return t("Working");
  return (
    {
      done: t("Finished"),
      error: t("Could not finish"),
      stopped: t("Stopped"),
      idle: t("Ready"),
      unknown: t("Status unavailable"),
      interrupted: t("Interrupted"),
      queued: t("Queued"),
      stopping: t("Stop requested"),
      blocked: t("Needs your help"),
    }[snapshot.agent.state] || t("Status unavailable")
  );
}
// A conversation's name is a short label, not the whole first request.
export function conversationTitle(text) {
  const title=cleanTitle(text);
  return title==='New conversation' ? t(title) : title;
}
export function fileLink(cid, file) {
  if (isImage(file)) return `<div class="image-file-card">${attachmentPreview(cid,file)}<div><strong>${e(file.name)}</strong><small>${formatFileSize(file.size)}</small></div><a class="icon-button" href="/api/conversations/${encodeURIComponent(cid)}/files/${encodeURIComponent(file.id)}" download target="_blank" rel="noopener noreferrer" aria-label="${e(t('Download') + ': ' + file.name)}">${icon('download')}</a></div>`;
  const interactive = file.name.endsWith('.agent.json');
  return `<div class="file-actions attachment-card"><button type="button" class="live-file" title="${e(file.name)}" data-feature="preview" data-cid="${e(cid)}" data-file="${e(file.id)}"><span class="attachment-glyph">${icon(interactive ? 'saved' : 'file')}</span><span class="attachment-copy"><strong>${e(file.name)}</strong><small>${formatFileSize(file.size)} · ${e(interactive ? t('Interactive result') : file.name.split('.').at(-1)?.toUpperCase() || t('File'))}</small></span></button><div class="attachment-actions"><a class="icon-button" href="/api/conversations/${encodeURIComponent(cid)}/files/${encodeURIComponent(file.id)}" download target="_blank" rel="noopener noreferrer" aria-label="${e(t('Download'))}">${icon('download')}</a><button class="text-button" data-feature="preview" data-cid="${e(cid)}" data-file="${e(file.id)}">${t('Preview')}</button>${interactive ? `<button class="text-button" data-feature="import-artifact" data-cid="${e(cid)}" data-file="${e(file.id)}">${icon('arrow')}${t('Open interactive result')}</button>` : ''}</div></div>`;
}
// Upstream expires a pending proposal after fifteen minutes; the card says so.
const APPROVAL_LIFETIME = 15 * 60;
const KINDS = { purchase: "Purchase", booking: "Booking", message: "Message", other: "Action" };
const KIND_ICONS = { purchase: "bag", booking: "calendar", message: "mail", other: "ongoing" };
const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "via", "with"]);
const BRAND_CASES = {
  kitchenaid: "KitchenAid",
  imessage: "iMessage",
  iphone: "iPhone",
  ipad: "iPad",
  icloud: "iCloud",
  macos: "macOS",
  ios: "iOS",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  github: "GitHub",
  gitlab: "GitLab",
  doordash: "DoorDash",
  whatsapp: "WhatsApp",
  wechat: "WeChat",
  paypal: "PayPal",
  oneplus: "OnePlus",
  airpods: "AirPods",
  macbook: "MacBook",
  ebay: "eBay",
  etransfer: "e-Transfer",
  "e-transfer": "e-Transfer",
  "mcdonald's": "McDonald's",
  mcdonalds: "McDonald's",
};
function smartCase(text) {
  const s = String(text || "").trim();
  if (!s || s !== s.toLowerCase() || !/[a-z]/.test(s)) return s;
  return s
    .split(/(\s+)/)
    .map((word, idx) => {
      if (!/[a-z]/.test(word)) return word;
      const lower = word.toLowerCase();
      if (BRAND_CASES[lower]) return BRAND_CASES[lower];
      if (/^(bc|ab|on|qc|mb|sk|ns|nb|pe|nl|yt|nt|nu|ca|us|uk|ny|wa|tx|fl)$/i.test(word) && idx > 0)
        return word.toUpperCase();
      if (/^(?!\d+(?:st|nd|rd|th)$)(?=.*[a-z])(?=.*\d)[a-z0-9-]{2,}$/i.test(word))
        return word.toUpperCase();
      if (idx > 0 && SMALL_WORDS.has(lower)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");
}
export function formatDestination(raw) {
  const text = String(raw || "").trim();
  if (!text) return { platform: "", title: t("Proposed action"), notes: [], short: "" };
  const compound = /[\u2014\u2013;(),/]|\b(?:via|through)\b/i.test(text);
  if (!compound) {
    const title = smartCase(text);
    return { platform: "", title, notes: [], short: text };
  }
  const clauses = text.split(/\s*;\s*/).filter(Boolean);
  let head = clauses[0] || text;
  const notes = [];
  let platform = "";
  const viaMatch = head.match(/^(.*?)(?:,\s*|\s+)\b(?:via|through)\s+([^,;()]+)$/i);
  if (viaMatch && viaMatch[1].trim() && viaMatch[2].trim()) {
    head = viaMatch[1].trim();
    platform = smartCase(viaMatch[2].trim());
  }
  const dash = head.split(/\s+(?:\u2014|\u2013|-|\/)\s+/);
  if (dash.length > 1) {
    if (!platform) platform = smartCase(dash[0]);
    head = dash.slice(1).join(" — ");
  }
  head = head.replace(/\(([^)]+)\)/g, (_, inner) => {
    if (inner.trim()) notes.push(smartCase(inner.trim()));
    return "";
  }).trim();
  if (head.includes(",")) {
    const commaParts = head.split(/\s*,\s*/).filter(Boolean);
    if (commaParts.length > 1) {
      head = commaParts[0];
      for (const extra of commaParts.slice(1)) {
        notes.push(smartCase(extra));
      }
    }
  }
  for (const extra of clauses.slice(1)) {
    if (extra.trim()) notes.push(smartCase(extra.trim()));
  }
  const title = smartCase(head) || platform || smartCase(text);
  if (platform && title === platform) platform = "";
  const short = platform ? `${platform} — ${title}` : title;
  return { platform, title, notes, short };
}
const CURRENCY_CODE = String.raw`(?:CAD|USD|EUR|GBP|AUD|JPY|CNY|CHF|HKD|SGD|NZD|INR|MXN|BRL|KRW|SEK|NOK|DKK|PLN)`;
const PRICE_VALUE = String.raw`[-−]?(?:(?:[A-Z]{1,3}\s*)?[$£€¥]\s*\d+(?:,\d{3})*(?:\.\d{1,2})?|${CURRENCY_CODE}\s+\d+(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:,\d{3})*(?:\.\d{1,2})?\s*${CURRENCY_CODE}|free\b)`;
const SEGMENT_END_PRICE = new RegExp(
  String.raw`^(.+?)\s*(?:[:—–-]\s*)?\((${PRICE_VALUE})\)$|^(.+?)\s*(?:[:—–-]\s*|\s+)(${PRICE_VALUE})$`,
  "i",
);
const SEGMENT_START_PRICE = new RegExp(String.raw`^(${PRICE_VALUE})\s+(.+)$`, "i");
const EQUALS_TOTAL = new RegExp(String.raw`^(.+?)\s*=\s*(${PRICE_VALUE})(?:\s+.*)?$`, "i");
const ONLY_PAREN_PRICE = new RegExp(String.raw`^\(\s*${PRICE_VALUE}\s*\)$`, "i");
function cleanReceiptLabel(raw) {
  const s = String(raw || "")
    .replace(/^[\s,:;—–-]+|[\s,:;—–-]+$/g, "")
    .replace(/^plus\s+/i, "")
    .trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function parsePriceBreakdown(raw) {
  let line = String(raw || "").trim().replace(/[.。]+$/u, "").trim();
  if (!line) return null;
  line = line.replace(/^(?:price\s+breakdown|cost\s+breakdown|breakdown|pricing|charges)\s*:\s*/i, "");
  let total = "";
  let note = "";
  const eq = line.match(EQUALS_TOTAL);
  if (eq) {
    const rhs = line.slice(eq[1].length).trim();
    const parenMatch = rhs.match(/\(([^()]+)\)\s*$/);
    if (parenMatch && !/^(?:no\s+tip|excluding\s+tip)/i.test(parenMatch[1].trim())) {
      note = parenMatch[1].trim();
    }
    line = eq[1].trim();
    total = eq[2].replace(/\s+/g, " ").trim();
  }
  const parts = (
    line.includes("+")
      ? line.split(/\s*\+\s*/)
      : line.includes(";")
        ? line.split(/\s*;\s*/)
        : line.split(/\s*,(?!\d)\s*/)
  ).filter(Boolean);
  if (parts.length < 2) return null;
  const items = [];
  for (const rawPart of parts) {
    let part = rawPart.replace(/,\s*(?:no\s+tip[^;()]*|excluding\s+tip[^;()]*)$/i, "").trim();
    const trailingParen = part.match(/\([^()]*\)\s*$/);
    if (trailingParen && !ONLY_PAREN_PRICE.test(trailingParen[0].trim())) {
      part = part.slice(0, trailingParen.index).trim();
    }
    const endMatch = part.match(SEGMENT_END_PRICE);
    const startMatch = endMatch ? null : part.match(SEGMENT_START_PRICE);
    if (!endMatch && !startMatch) return null;
    const rawLabel = endMatch ? endMatch[1] || endMatch[3] : startMatch[2];
    const rawAmount = endMatch ? endMatch[2] || endMatch[4] : startMatch[1];
    const label = cleanReceiptLabel(rawLabel);
    const rawAmtClean = String(rawAmount || "").replace(/\s+/g, " ").trim();
    const amount = /^free$/i.test(rawAmtClean) ? t("Free") : rawAmtClean;
    if (!label || !amount || label.length > 56 || /\b(includes|charged|requires|shown|ending|selected)\b/i.test(label)) {
      return null;
    }
    if (/^(?:(?:displayed|estimated|checkout|order)\s+)*total$/i.test(label)) {
      if (!total) total = amount;
      continue;
    }
    items.push({ label, amount });
  }
  return items.length >= 2 ? { items, total, ...(note ? { note } : {}) } : null;
}
function localizeFactLine(line) {
  if (getLanguage() !== "zh-CN") return line;
  const s = String(line || "").trim();
  const cardMatch = s.match(/^(?:Pay\s+(?:with|using)\s+)?(?:saved|selected)\s+([A-Za-z ]+?)\s+ending\s+(\d{4})\.?$/i);
  if (cardMatch) {
    return t("Pay with {brand} ending {last4}", { brand: cardMatch[1].trim(), last4: cardMatch[2] });
  }
  const etaMatch = s.match(/^Estimated(?:\s+arrival|\s+delivery)?\s+(.+?)\.?$/i);
  if (etaMatch) {
    return t("Estimated arrival {time}", { time: etaMatch[1].trim() });
  }
  const stdEtaMatch = s.match(/^Standard\s+delivery,\s*estimated\s+([^;.]+?)(?:[;,]\s*leave\s+at\s+door)?\.?$/i);
  if (stdEtaMatch) {
    const leave = /leave\s+at\s+door/i.test(s);
    return leave
      ? t("Standard delivery, estimated {time} · leave at door", { time: stdEtaMatch[1].trim() })
      : t("Standard delivery, estimated {time}", { time: stdEtaMatch[1].trim() });
  }
  const delivMatch = s.match(/^(?:Standard\s+delivery|Deliver)\s+to\s+(.+?)(?:[;,]\s*leave\s+at\s+door)?(?:[;.]\s*estimated\s+([^.]+))?\.?$/i);
  if (delivMatch) {
    const leave = /leave\s+at\s+door/i.test(s);
    const addr = delivMatch[1].trim();
    const eta = delivMatch[2]?.trim();
    const base = leave
      ? t("Deliver to {address} · leave at door", { address: addr })
      : t("Deliver to {address}", { address: addr });
    return eta ? `${base} · ${t("Estimated arrival {time}", { time: eta })}` : base;
  }
  return s;
}
function approvalInline(value) {
  const tokens = [];
  const put = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = e(String(value || "").replace(/\u0000/g, ""));
  s = s.replace(/`([^`\n]+)`/g, (_, code) => put(`<code>${code}</code>`));
  s = s.replace(/\*\*([^\n]+?)\*\*(?!\*)/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  s = s.replace(/\s+\|\s+/g, '<span class="approval-fact-sep">·</span>');
  s = s.replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, idx) => tokens[Number(idx)]);
}
function splitApprovalParts(text) {
  if (/(?:^|\n)\s*(?:[•*▪▸-]|\d+\.)\s+/u.test(text)) {
    const rawChunks = text
      .replace(/^\s*(?:[•*▪▸-]|\d+\.)\s+/u, "")
      .split(/\n+\s*(?:[•*▪▸-]|\d+\.)\s+/u)
      .map((x) => x.trim())
      .filter(Boolean);
    if (rawChunks.length > 1) return rawChunks;
  }
  const lines = text.includes("\n")
    ? text.split(/\n+/).map((x) => x.trim()).filter(Boolean)
    : [text];
  return lines
    .flatMap((line) => line.split(/(?<=\.)\s+(?=[A-Z0-9])/u))
    .map((x) => x.trim())
    .filter(Boolean);
}
function trimFactPeriod(value) {
  return String(value || "").trim().replace(/\.(?=["”')]?$)/, "");
}
function renderApprovalFact(line, factIcon) {
  const localized = localizeFactLine(line);
  const labelMatch = localized.match(/^([A-Za-z][A-Za-z0-9 &/()-]{1,28}):\s+([\s\S]+)$/);
  if (!labelMatch) {
    return `<li>${icon(factIcon(line))}<span>${approvalInline(trimFactPeriod(localized))}</span></li>`;
  }
  const label = labelMatch[1].trim();
  const rawVal = labelMatch[2].trim();
  const unquoted = rawVal.replace(/^["“]([\s\S]+)["”]$/, "$1").trim();
  const isQuote = Boolean(
    (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
      rawVal.includes("\n") ||
      /^(?:inquiry\s+)?note$|^message$|^instructions$/i.test(label),
  );
  const valueHtml = isQuote
    ? `<blockquote class="approval-fact-quote">${approvalInline(unquoted)}</blockquote>`
    : `<span class="approval-fact-value">${approvalInline(trimFactPeriod(rawVal))}</span>`;
  return `<li class="approval-fact-kv">${icon(factIcon(line))}<div class="approval-fact-body"><strong class="approval-fact-label">${e(t(label))}</strong>${valueHtml}</div></li>`;
}
function parseApprovalDescription(raw, hasReceipt = false, isPurchase = false) {
  const text = String(raw || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/^(?:supersedes\s+.+?(?<!\d)\.(?!\d)\s*|revised\s+order,\s*superseding\s+[^:]+:\s*)/i, "")
    .trim();
  if (!text) return { html: "", receipt: [], receiptTotal: "" };
  const parts = splitApprovalParts(text);
  const receipt = [];
  let receiptTotal = "";
  const kept = [];
  for (let i = 0; i < parts.length; i++) {
    const breakdown = parts.length > 1 ? parsePriceBreakdown(parts[i]) : null;
    if (breakdown) {
      receipt.push(...breakdown.items);
      if (breakdown.total && !receiptTotal) receiptTotal = breakdown.total;
      if (breakdown.note) kept.push(`Terms: ${breakdown.note}`);
    } else {
      kept.push(parts[i]);
    }
  }
  let orderItems = [];
  if (isPurchase && (receipt.length || hasReceipt) && /^Order:\s*/i.test(kept[0] || '')) {
    const candidates = kept[0].replace(/^Order:\s*/i, '').split(/;\s*/).map(item => item.trim()).filter(Boolean);
    if (candidates.length > 1 && candidates.every(item => /^\d+\s+\S/.test(item))) {
      orderItems = candidates;
      kept.shift();
    }
  }
  const startsWithBullet = /^\s*(?:[•*▪▸-]|\d+\.)\s+/u.test(text);
  if (!kept.length) return { html: "", receipt, receiptTotal, orderItems };
  if (!startsWithBullet && (kept.length <= 1 || (!receipt.length && text.length < 90 && !text.includes("\n")))) {
    return { html: `<p class="object-detail">${approvalInline(kept.join(" "))}</p>`, receipt, receiptTotal, orderItems };
  }
  const factIcon = (line) =>
    /^(?:service\s+)?address\b|\blocation\b|\bdeliver\s+to\b/i.test(line)
      ? "pin"
      : /^(?:preferred\s+)?schedule\b|\bappointment\b|\bdate\b|\bwindow\b/i.test(line)
        ? "calendar"
        : /^contact\b|\bemail\b|\bphone\b|\brecipient\b/i.test(line)
          ? "mail"
          : /^(?:inquiry\s+)?note\b|\bmessage\b|\binstructions\b/i.test(line)
            ? "file"
            : /visa|mastercard|amex|american express|pay\b|card|charge|payment|e-transfer/i.test(line)
              ? "card"
              : /item|total|subtotal|tax|tip|\$/i.test(line)
                ? "bag"
                : /delivery|estimated|arrive|arriving|pickup|standard|leave at/i.test(line)
                  ? "clock"
                  : "shield";
  const leadHtml = startsWithBullet ? "" : `<p class="object-detail">${approvalInline(kept[0])}</p>`;
  const factItems = startsWithBullet ? kept : kept.slice(1);
  const html = `${leadHtml}<ul class="approval-facts">${factItems.map((line) => renderApprovalFact(line, factIcon)).join("")}</ul>`;
  return { html, receipt, receiptTotal, orderItems };
}
function consequence(p, destination = p.destination) {
  const amount = p.amount ? `${p.amount} ${p.currency || ""}`.trim() : "";
  if (p.kind === "purchase") return amount ? t("Approving lets your agent pay {amount} at {destination}. Nothing is charged until it confirms the order.", { amount, destination }) : t("Approving lets your agent complete a purchase at {destination}.", { destination });
  if (p.kind === "booking") return t("Approving lets your agent make this booking at {destination}.", { destination });
  if (p.kind === "message") return t("Approving lets your agent send this message through {destination}.", { destination });
  return t("Approving lets your agent carry out this action at {destination}.", { destination });
}
const CHARGE_SUMMARY_RE = /^(?:items?|item\s+subtotal|subtotal|delivery(?:\s+fee)?|shipping(?:\s+&\s+handling)?|service\s+fee|small\s+order\s+fee|bag\s+fee|regulatory\s+response\s+fee|taxes?\b.*|gst\b.*|pst\b.*|hst\b.*|vat\b.*|tip\b.*|driver\s+tip\b.*|discount\b.*|promo(?:tion)?\b.*|credit\b.*|order\s+total\b.*)$/i;
function isChargeSummaryLabel(label) {
  return CHARGE_SUMMARY_RE.test(String(label || "").trim());
}
function isSubtotalLabel(label) {
  return /^(?:items?|item\s+subtotal|subtotal)$/i.test(String(label || "").trim());
}
function formatReceiptTotal(amount, currency, fallbackTotal, receiptItems) {
  const fallback = String(fallbackTotal || "").trim();
  if (!amount) return e(fallback);
  const amtStr = String(amount).trim();
  const curStr = String(currency || "").trim().toUpperCase();
  const sample = [fallback, ...(receiptItems || []).map((r) => String(r?.amount || ""))].find(Boolean) || "";
  const prefixMatch = sample.match(/^((?:CA|US|AU|NZ|HK|SG)?[$£€¥])\s*\d/);
  if (prefixMatch && /^\d/.test(amtStr)) {
    const sym = prefixMatch[1];
    if (
      (curStr === "CAD" && (sym === "CA$" || sym === "$")) ||
      (curStr === "USD" && (sym === "US$" || sym === "$")) ||
      (curStr === "EUR" && sym === "€") ||
      (curStr === "GBP" && sym === "£") ||
      !curStr
    ) {
      return `${e(sym)}${e(amtStr)}${curStr ? ` <small class="receipt-currency-code">${e(curStr)}</small>` : ""}`;
    }
  }
  return `${e(amtStr)} ${e(curStr)}`.trim();
}
function renderReceiptAmount(amount) {
  const s = String(amount || "").trim();
  const m = s.match(/^([A-Z]{2,3}\s+|[A-Z]{1,3})?([$£€¥])\s*(\d[\d,.]*)$/);
  if (m) {
    return `${m[1] ? `<span class="receipt-cur-prefix">${e(m[1])}</span>` : ""}<span class="receipt-cur-sym">${e(m[2])}</span>${e(m[3])}`;
  }
  return e(s);
}
const HOST_SESSION_LABELS = {sign_out:'Sign out of Windows',shutdown:'Shut down the PC',restart:'Restart the PC',sleep:'Put the PC to sleep',hibernate:'Hibernate the PC',lock:'Lock Windows'};
function hostSessionApprovalCard(cid, approval, stale) {
  const action=approval.action || {},pending=approval.status==='pending';
  const usable=approval.status==='approved' && !approval.consumed && Date.now()/1000-(approval.decided||0)<=300;
  const attrs=`data-conversation="${e(cid)}" data-fingerprint="${e(approval.fingerprint)}" ${stale?'disabled':''}`;
  const buttons=pending
    ? `<button class="secondary" data-approval="${e(approval.id)}" ${attrs} data-decision="false">${e(t('Cancel'))}</button><button class="primary" data-approval="${e(approval.id)}" ${attrs} data-decision="true">${e(t('Approve and take control'))}</button>`
    : usable ? `<button class="primary" data-continue="${e(approval.id)}" ${attrs}>${e(t('Open desktop controls'))}</button>` : '';
  const outcome=approval.consumed?'Approval used':approval.status==='approved'&&!usable?'Approval expired':statusLabel(approval.status);
  return `<section class="approval-card live-approval" data-kind="host_session" data-status="${e(approval.status)}"><div class="approval-content"><div class="object-eyebrow">${icon('windows')}<span>${e(t('Desktop permission'))}</span></div><h3>${e(t(HOST_SESSION_LABELS[action.operation] || 'Change Windows session'))}</h3><p class="object-detail">${e(action.description || '')}</p><p class="approval-consequence">${icon('shield')}<span>${e(t('After approval, you perform the final action in Operator Desktop. Approval is valid once for five minutes.'))}</span></p>${!pending?`<p class="approval-outcome">${e(t(outcome))}</p>`:''}<div class="approval-actions">${buttons}</div></div></section>`;
}

function administratorApprovalCard(cid, approval, stale, active) {
  const action=approval.action, pending=approval.status==='pending';
  const program=String(action.program || '').split(/[\\/]/).pop();
  const result=approval.admin_result?.state;
  const status=result==='launched'?'Started':result==='unknown'?'Check the desktop':result==='failed'?'Launch failed':approval.consumed?'Starting…':approval.status==='approved'?'Approved':statusLabel(approval.status);
  const buttons=pending ? `<button class="secondary" data-approval="${e(approval.id)}" data-conversation="${e(cid)}" data-fingerprint="${e(approval.fingerprint)}" data-decision="false" ${stale?'disabled':''}>${t('Not now')}</button><button class="primary" data-approval="${e(approval.id)}" data-conversation="${e(cid)}" data-fingerprint="${e(approval.fingerprint)}" data-decision="true" ${stale?'disabled':''}>${t('Allow & continue')}</button>` : approval.status==='approved' && !approval.consumed && !active ? `<button class="primary" data-continue="${e(approval.id)}" data-conversation="${e(cid)}" data-fingerprint="${e(approval.fingerprint)}" ${stale?'disabled':''}>${t('Continue task')}</button>` : '';
  const timed=approval.admin_allowance_active && Number(approval.allowed_until)*1000>Date.now();
  const durationChoice=pending?`<fieldset class="admin-duration"><legend>${e(t('Administrator access'))}</legend>${[[0,'Just once'],[15,'15 minutes'],[60,'1 hour']].map(([minutes,label])=>`<label><input type="radio" name="admin-duration-${e(approval.id)}" data-admin-duration="${e(approval.id)}" value="${minutes}" ${minutes===0?'checked':''}><span>${e(t(label))}</span></label>`).join('')}</fieldset><p class="admin-duration-scope">${e(t('Timed access applies to this chat'))}</p>`:'';
  const allowance=timed?`<div class="admin-allowance-receipt"><span>${icon('clock')}${e(t('Allowed until {time}',{time:new Date(approval.allowed_until*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}))}</span><button type="button" data-revoke-admin="${e(approval.grant_id)}" data-approval-id="${e(approval.id)}" data-conversation="${e(cid)}" data-fingerprint="${e(approval.fingerprint)}">${e(t('End access'))}</button></div>`:'';
  const outcomeIcon=result==='launched'?'check-circle':result==='failed'||result==='unknown'?'warning':'clock';
  const outcome=pending ? '' : `<div class="approval-actions admin-settled-footer">${status!=='Approved'?`<p class="approval-outcome" data-launch-state="${e(result || 'pending')}">${icon(outcomeIcon)}<strong>${e(t(status))}</strong></p>`:''}${approval.status==='approved'?`<button type="button" class="primary approval-complete" disabled aria-label="${e(t('Approved'))}">${icon('check-circle')}${e(t('Approved'))}</button>`:''}</div>`;
  return `<section class="approval-card live-approval" data-kind="windows_admin" data-status="${e(approval.status)}"><div class="approval-content"><div class="object-eyebrow">${icon('shield')}<span>${t('Administrator access')}</span></div><h3>${e(action.description)}</h3><p class="admin-executable">${icon('windows')}<span>${e(program)}</span></p><details class="approval-confirmation-details"><summary>${icon('chevron')}${t('Launch details')}</summary><p class="object-detail"><code>${e(action.program)}</code></p>${action.arguments?.length?`<p class="object-detail"><code>${e(action.arguments.join(' '))}</code></p>`:''}</details>${durationChoice}${outcome}${allowance}${buttons?`<div class="approval-actions">${buttons}</div>`:''}</div></section>`;
}

export function approvalCard(cid, a, active, stale, confirmed = null, extraClass = "") {
  if (a.action?.kind === "windows_admin") return administratorApprovalCard(cid,a,stale,active);
  if (a.action?.kind === "host_session") return hostSessionApprovalCard(cid,a,stale);
  const p = a.action || {};
  const kind = p.kind || "other";
  const pending = a.status === "pending";
  const dest = formatDestination(p.destination);
  const desc = parseApprovalDescription(p.description, Boolean(a.receiptItems?.length), kind === 'purchase');
  const receiptItems = a.receiptItems?.length ? a.receiptItems : desc.receipt;
  const totalDisplay = formatReceiptTotal(p.amount, p.currency, desc.receiptTotal, receiptItems);
  const orderItems = desc.orderItems || [];
  const itemIndex = receiptItems.findIndex(r => isSubtotalLabel(r.label));
  const itemList = orderItems.length ? `<ul class="receipt-order-items">${orderItems.map(item => `<li>${e(item)}</li>`).join('')}</ul>` : '';
  const hasPurchasedRows = itemIndex > 0 || receiptItems.some((r, idx) => !isChargeSummaryLabel(r.label) && (itemIndex < 0 || idx < itemIndex));
  const renderReceiptRow = (r, i) => {
    const summaryRow = isChargeSummaryLabel(r.label) || (itemIndex >= 0 && i >= itemIndex);
    const subtotalRow = isSubtotalLabel(r.label);
    const firstSummaryAfterItems = hasPurchasedRows && summaryRow && (i === itemIndex || (itemIndex < 0 && i > 0 && !isChargeSummaryLabel(receiptItems[i - 1]?.label)));
    const zeroVal = /^(?:(?:[A-Z]{1,3}\s*)?[$£€¥]\s*0(?:\.00)?|0(?:\.00)?\s*[A-Z]{3}|free|免费)$/i.test(String(r.amount || "").trim());
    const cls = [
      "receipt-line",
      summaryRow ? "is-summary" : "is-item",
      subtotalRow ? "is-subtotal" : "",
      firstSummaryAfterItems ? "is-summary-start" : "",
      zeroVal ? "is-zero" : "",
    ].filter(Boolean).join(" ");
    return `<dl class="${cls}"><dt>${e(t(r.label))}</dt><dd>${renderReceiptAmount(r.amount)}</dd></dl>${i === itemIndex ? itemList : ""}`;
  };
  const priceBlock = receiptItems.length
    ? `<div class="approval-receipt"><div class="receipt-lines">${itemList && itemIndex < 0 ? `<div class="receipt-order-group"><span>${e(t('Items'))}</span>${itemList}</div>` : ''}${receiptItems.map(renderReceiptRow).join("")}</div>${totalDisplay ? `<div class="price-row"><span>${t("Total")}</span><strong>${totalDisplay}</strong></div>` : ""}</div>`
    : totalDisplay
      ? `<div class="price-row"><span>${t("Total")}</span><strong>${totalDisplay}</strong></div>`
      : "";
  const left = pending && a.created ? Math.max(0, Math.round((a.created + APPROVAL_LIFETIME - Date.now() / 1000) / 60)) : null;
  const meta = [
    a.created ? t("Proposed {time}", { time: new Date(a.created * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : "",
    left !== null && !a.syntheticCheckout ? (left > 0 ? t("Expires in {minutes} min", { minutes: left }) : t("Expiring now")) : "",
    a.decided && !pending ? t("{status} {time}", { status: statusLabel(a.status), time: new Date(a.decided * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : "",
  ].filter(Boolean).join(" · ");
  const outcome = a.status !== "approved" ? "" : confirmed
    ? `<div class="approval-confirmation-note">${icon('check')}<span>${e(confirmed.confirmation || confirmed.title || "")}</span></div>`
    : active
      ? ""
      : `<p class="approval-outcome" data-outcome="waiting">${icon("clock")}${t("Approved. No confirmation has been recorded yet.")}</p>`;
  const metaHtml = meta ? `<p class="approval-meta">${e(meta)}</p>` : "";
  const actionsHtml = a.syntheticCheckout
    ? `${metaHtml}<div class="approval-actions"><button type="button" class="secondary" data-live-action="checkout-decline" data-cid="${e(cid)}" ${stale ? "disabled" : ""}>${t("Decline")}</button><button type="button" class="primary" data-live-action="checkout-approve" data-cid="${e(cid)}" data-item="${e(dest.title)}" ${stale ? "disabled" : ""}>${t("Approve & continue")}</button></div>`
    : pending
      ? `${metaHtml}<div class="approval-actions"><button class="secondary" data-approval="${e(a.id)}" data-conversation="${cid}" data-fingerprint="${e(a.fingerprint)}" data-decision="false" ${stale ? "disabled" : ""}>${t("Decline")}</button><button class="primary" data-approval="${e(a.id)}" data-conversation="${cid}" data-fingerprint="${e(a.fingerprint)}" data-decision="true" ${stale ? "disabled" : ""}>${t("Approve & continue")}</button></div>`
      : a.status === "approved"
        ? `<div class="approval-footer-settled"><div class="approval-actions">${metaHtml}<button type="button" class="primary approval-complete" disabled aria-label="${e(t(confirmed ? 'Confirmed' : 'Approved'))}">${icon('check')}${e(t(confirmed ? 'Confirmed' : 'Approved'))}</button></div>${outcome}${!active && !confirmed ? `<button class="secondary" data-continue="${e(a.id)}" data-conversation="${cid}" data-fingerprint="${e(a.fingerprint)}" ${stale ? "disabled" : ""}>${t("Continue task")}</button>` : ""}</div>`
        : `${metaHtml}<p class="quiet-note">${t({ expired: "Approval request expired. Please try again to continue", superseded: "This proposal was replaced by a newer one.", declined: "Declined. Nothing was done." }[a.status] || "This request is no longer waiting for a decision.")}</p>`;
  return `<section class="approval-card live-approval${extraClass ? ` ${extraClass}` : ""}" data-status="${e(a.status)}" data-kind="${e(kind)}"><div class="approval-content"><div class="object-eyebrow"><span class="approval-kind-badge">${icon(KIND_ICONS[kind] || "ongoing")}${e(t(KINDS[kind] || "Action"))}</span><span class="approval-status-badge"><i></i>${pending ? t("For you to review") : e(statusLabel(a.status))}</span></div><div class="approval-merchant"><div class="approval-merchant-copy"><span class="approval-platform">${siteBadge(dest.platform || p.destination, "", "xs")}${e(dest.platform || dest.short || p.destination)}</span><h3>${e(dest.title)}</h3>${dest.notes.length ? `<div class="approval-sub">${dest.notes.map((n) => `<span>${icon("pin")}${e(n)}</span>`).join("")}</div>` : ""}</div></div>${desc.html}${a.delivery_estimate ? `<p class="approval-outcome">${icon("clock")}<span>${e(t("Estimated delivery"))}: ${e(a.delivery_estimate)}</span></p>` : ""}${priceBlock}${pending ? `<p class="approval-consequence">${icon("shield")}<span>${e(consequence(p, dest.short || p.destination))}</span></p>` : ""}${p.terms ? `<p class="terms">${e(p.terms)}</p>` : ""}${actionsHtml}</div></section>`;
}

// Upgrade checkout-ready result cards (e.g. Amazon checkout stops where the model called
// job_result instead of job_approval) into the full receipt + order approval card.
export function checkoutApprovalFromResult(cid, result, job, browserState, active, stale, extraClass = "", snapshot = null) {
  if ((job?.approvals || []).length > 0) return null;
  const title = String(result?.title || "").trim();
  const summary = String(result?.summary || "").trim();
  const combined = `${title}\n${summary}`;
  if (/\|.*\|[\s\S]*\|---/.test(summary)) return null;
  const alreadyPlaced = /\b(?:order placed|order confirmed)\b|下单成功|已下单/i.test(combined);
  const notAtPaymentCheckout =
    /\b(?:payment page not yet reached|not yet at checkout|(?:toward|to|before|proceed to|continue to)\s+checkout|passenger\s+(?:form|details|information)|guest\s+(?:passenger|form)|sign[\s-]?in\s+required|fare\s+subject\s+to\s+change)\b/i.test(combined);
  const isCheckoutStop =
    !alreadyPlaced &&
    !notAtPaymentCheckout &&
    /\b(?:ready at checkout|checkout is open(?:\s+for\s+review)?|stopped at checkout|waiting at checkout)\b|(?:已到结账页面|结账页面已打开)(?:.*(?:未下单|尚未下单|待确认))?/i.test(combined);
  const priceMatch = combined.match(/\b((?:CA|US)?\$\s*\d+(?:,\d{3})*(?:\.\d{2})?|(?:CAD|USD|EUR|GBP)\s*\d+(?:,\d{3})*(?:\.\d{2})?)/i);
  if (!isCheckoutStop || !priceMatch) return null;
  if (snapshot) {
    const rCreated = (result?.created || 0) > 1e11 ? (result.created || 0) / 1000 : result?.created || 0;
    const lastUserReqTs = Math.max(
      0,
      ...(snapshot.requests || [])
        .filter((req) => !String(req.id || "").startsWith("approval-"))
        .map((req) => ((req.created || req.created_ts || 0) > 1e11 ? (req.created || req.created_ts) / 1000 : req.created || req.created_ts || 0)),
    );
    const runStartedTs = snapshot.agent?.started_ts || 0;
    if (rCreated > 0 && (lastUserReqTs > rCreated + 0.5 || (active && runStartedTs > rCreated + 0.5))) {
      return null;
    }
  }

  const shotUrl = browserState?.shot?.url || "";
  const shotTitle = browserState?.shot?.title || "";
  const evUrls = (job?.evidence || []).flatMap((ev) => [ev.source || "", ...(ev.urls || [])]).join(" ");
  const merchantHint = `${shotUrl} ${shotTitle} ${evUrls} ${combined}`;
  let platform = "";
  if (/amazon/i.test(merchantHint)) platform = "Amazon";
  else if (/uber\s*eats/i.test(merchantHint)) platform = "Uber Eats";
  else if (/doordash/i.test(merchantHint)) platform = "DoorDash";
  else if (/instacart/i.test(merchantHint)) platform = "Instacart";
  else if (/airbnb/i.test(merchantHint)) platform = "Airbnb";

  const cleanTitle = title.replace(/\s+(?:ready\s+)?at\s+checkout$/i, "").trim() || title;
  const destination = platform && !new RegExp(`^${platform}\\b`, "i").test(cleanTitle)
    ? `${platform} / ${cleanTitle}`
    : cleanTitle;

  const rawPrice = priceMatch[1].replace(/\s+/g, "");
  const numericAmount = rawPrice.replace(/^[A-Za-z$]+/, "");
  const currency = /^CA\$|^CAD/i.test(rawPrice) ? "CAD" : /^US\$|^USD/i.test(rawPrice) ? "USD" : "";

  const bullets = summary
    .split(/\n+/)
    .map((line) => line.replace(/^[\s*-]+/, "").replace(/\*\*/g, "").trim())
    .filter((line) => line && !/^checkout is open|^no order has been placed/i.test(line));

  const receiptItems = [];
  const factLines = [];
  for (const b of bullets) {
    if (/^total\s*:/i.test(b)) {
      const freeShip = /free\s+shipping/i.test(b);
      const inclTax = /including\s+tax/i.test(b);
      if (freeShip) receiptItems.push({ label: "Shipping", amount: t("Free") });
      if (inclTax) receiptItems.push({ label: "Order total (incl. tax)", amount: rawPrice });
    } else {
      const sentence = b.endsWith(".") ? b : `${b}.`;
      factLines.push(sentence);
    }
  }
  if (receiptItems.length === 1 && bullets[0]) {
    receiptItems.unshift({ label: bullets[0].replace(/\.$/, ""), amount: rawPrice });
  }

  return approvalCard(
    cid,
    {
      id: `checkout-${result.id || result.created || "ready"}`,
      status: "pending",
      created: result.created || 0,
      syntheticCheckout: true,
      receiptItems,
      action: {
        kind: "purchase",
        destination,
        description: factLines.join(" ") || summary,
        amount: numericAmount || rawPrice,
        currency,
      },
    },
    active,
    stale,
    null,
    extraClass,
  );
}

export function standaloneFiles(workspace) {
  const embedded = new Set(
    workspace.jobs.flatMap((job) =>
      (job.results || []).flatMap((result) => [...(result.file_ids || []), ...(result.presentation?.entries || []).flatMap(entryImageIds)]),
    ),
  );
  return workspace.files.filter((file) => !embedded.has(file.id));
}
export function resultCard(cid, result, files, evidence = [], extraClass = "") {
  const confirmed=result.status==='confirmed';
  const outcome=resultOutcome(result);
  const evById = new Map((evidence || []).map((ev) => [ev.id, ev]));
  const matchedEv = (result.evidence_ids || [])
    .map((id) => evById.get(id))
    .filter(Boolean);
  const seenHosts = new Set();
  const evPills = [];
  for (const ev of matchedEv) {
    const sourceUrl = (ev.urls || [])[0] || ev.source || "";
    let rawUrl='';try{const url=new URL(sourceUrl);if(['https:','http:'].includes(url.protocol))rawUrl=url.href;}catch{}
    const host = rawUrl ? browserLocation(rawUrl).split("/")[0] : "";
    const key = host || ev.tool || ev.id;
    if (!key || seenHosts.has(key)) continue;
    seenHosts.add(key);
    evPills.push(
      host
        ? `<a class="evidence-pill" href="${e(rawUrl)}" target="_blank" rel="noopener noreferrer" title="${e(ev.summary || rawUrl)}">${siteBadge(rawUrl, "", "xs")}<span>${e(host)}</span>${icon('arrow')}</a>`
        : `<span class="evidence-pill" title="${e(ev.summary || ev.tool || "")}">${icon("check")}<span>${e(ev.tool || t("Verified"))}</span></span>`,
    );
  }
  const evBlock = evPills.length
    ? `<div class="result-evidence"><span class="evidence-label">${icon("shield")}${e(t("Sources"))}</span><div class="evidence-list">${evPills.join("")}</div></div>`
    : "";
  const confirmedHeader=confirmed ? `<header class="result-heading result-confirmed-heading"><span class="result-confirmed-status">${icon(outcome === 'done' ? 'check' : 'check-circle')}${e(t(outcome === 'done' ? 'Done' : 'Confirmed'))}</span><h3>${e(result.title||t('Result'))}</h3></header>` : '';
  const proof=confirmed && (result.confirmation||evPills.length) ? `<footer class="result-proof">${result.confirmation?`<div class="result-proof-copy">${icon('check')}<p>${e(result.confirmation)}</p></div>`:''}${evPills.length?`<div class="evidence-list">${evPills.join('')}</div>`:''}</footer>` : '';
  const layout=resultLayout(result,{cid,files});
  const embeddedImages=new Set(layout?.mediaIds||[]);
  const attached=(result.file_ids||[]).map(id=>files.find(file=>file.id===id)).filter(Boolean);
  const gallery=mediaStrip(cid,attached.filter(file=>isImage(file)&&!embeddedImages.has(file.id)),result.title||t('Photos'));
  const comparison=layout && ['home','place','product'].includes(layout.kind);
  const heading=layout
    ? `<header class="result-heading comparison-heading"><div><div class="comparison-kicker"><span>${icon(layout.glyph)}${e(t(layout.label))}</span>${comparison?`<small>${result.presentation.entries.length} ${e(t('options'))}</small>`:''}</div><h3>${e(result.title||t('Result'))}</h3></div></header>`
    : '';
  const checks=(result.checks||[]).map(check=>{
    const observations=(check.evidence_ids||[]).map(id=>evById.get(id)).filter(Boolean);
    const at=Math.max(0,...observations.map(item=>Number(item.observed)||0));
    const label=check.state==='verified'?(check.kind==='action'?'Action completed':'Outcome verified'):'Not verified';
    return `<li data-verified="${check.state==='verified'}">${icon(check.state==='verified'?'check-circle':'clock')}<div><strong>${e(label)}</strong><p>${e(check.text)}</p>${at?`<small>${e(new Date(at*1000).toLocaleString())}</small>`:''}</div></li>`;
  }).join('');
  const checkMarkup=checks?`<ul class="result-checks">${checks}</ul>`:'';
  const driving = layout ? null : drivingResult(result, matchedEv);
  const mode = driving ? travelMode(result) : null;
  return `<article data-result-status="${e(result.status || "found")}" data-result-outcome="${e(outcome)}" ${mode ? `data-travel-mode="${mode.name}"` : ''} class="live-result${confirmed ? ` confirmed-result${outcome === 'done' ? ' done-result' : ''}` : ''}${layout ? ` specialized-result result-${layout.kind}` : ""}${driving ? ' live-driving-result' : ''}${extraClass ? ` ${extraClass}` : ""}">${confirmed ? confirmedHeader : layout ? heading : `<header class="result-heading"><span class="result-glyph">${icon(result.status === "confirmed" ? "check-circle" : layout ? layout.glyph : mode ? mode.icon : "saved")}</span><div><span class="object-eyebrow">${e(result.status === "confirmed" ? t("Confirmed") : layout ? t(layout.label) : mode ? t(mode.label) : statusLabel(result.status))}</span><h3>${e(result.title || t("Result"))}</h3></div></header>`}${layout ? `${result.presentation?.subtitle ? `<p class="result-subtitle">${e(result.presentation.subtitle)}</p>` : ""}${layout.body}${result.summary ? `<details class="result-fare-details" data-result-details="${e(result.id || result.title || "")}" open><summary>${e(t("Details"))}${icon("chevron")}</summary><div class="live-prose">${richText(result.summary)}</div></details>` : ""}` : driving || `<div class="live-prose">${richText(result.summary || "")}</div>`}${checkMarkup}${confirmed ? proof : evBlock}${gallery}<div class="result-files">${attached.filter(file=>!isImage(file)).map(file=>fileLink(cid,file)).join('')}</div></article>`;
}
export function formatDuration(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  if (seconds < 60) return `${seconds}s`;
  return [
    Math.floor(seconds / 3600) && `${Math.floor(seconds / 3600)}h`,
    Math.floor((seconds % 3600) / 60) && `${Math.floor((seconds % 3600) / 60)}m`,
    seconds % 60 && `${seconds % 60}s`,
  ].filter(Boolean).join(" ");
}
export function isPlumbingStep(m, items, idx) {
  if (!m || m.role !== "action") return false;
  const text = String(m.text || "").trim();
  const d = String(m.detail || "").trim().split("\n")[0].trim();
  if (/^Reading file$/i.test(text)) {
    if (/^job_(?:library|state|file|update|approval|result|wait|memory|save_task)\b/i.test(d)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(d) || /^output\.txt$/i.test(d)) return true;
    if (/^page-\d{4}-\d{2}-\d{2}T[\w-]+\.ya?ml$/i.test(d)) return true;
  }
  const friendly = actionText(m);
  if (m.status === "failed" && (/^(?:Checking|Updating|Saving) task$|^Preparing result$|^Checking files$/i.test(friendly))) {
    const rest = (items || []).slice(idx + 1);
    if (rest.some((later) => later?.role === "action" && actionText(later) === friendly && ["completed", "done"].includes(later.status))) {
      return true;
    }
  }
  if (/^Switching tab$/i.test(text) && !d) return true;
  return false;
}

export function coalesceActions(items) {
  const out = [];
  for (const m of items || []) {
    const prev = out.at(-1);
    const hasUrl = Boolean(m?.detail && browserLocation(m.detail));
    if (
      prev &&
      m.role === "action" &&
      prev.role === "action" &&
      !hasUrl &&
      prev.text === m.text &&
      (prev.detail || "") === (m.detail || "") &&
      (prev.tool || "") === (m.tool || "")
    ) {
      prev.repeatCount = (prev.repeatCount || 1) + 1;
      prev.status = m.status || prev.status;
      continue;
    }
    out.push({ ...m, repeatCount: 1 });
  }
  return out;
}
function inferToolName(m, items, idx) {
  if (m?.tool && typeof m.tool === "string") {
    return m.tool.replace(/^mcp__[^_]+(?:_[^_]+)*__/, "");
  }
  const raw = String(m?.text || "").trim();
  const codeMatch = raw.match(/^Using\s+`([^`]+)`$/i);
  if (codeMatch) return codeMatch[1].trim();
  const namedMatch = raw.match(/^Using\s+(.+)$/i);
  if (namedMatch) {
    const candidate = namedMatch[1].trim();
    if (!/^(?:tool|browser|computer)$/i.test(candidate)) return candidate;
  }
  if (/^Using\s+tool$/i.test(raw)) {
    const actionItems = (items || []).filter((x) => x.role === "action");
    const pos = actionItems.indexOf(m);
    if (pos === 0) return "job_state";
    if (pos > 0 && pos === actionItems.length - 1) return "job_result";
    return "job_update";
  }
  return "";
}
function timestampMarkup(seconds, className = '') {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return '';
  const text = className === 'user-sent-time' ? date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : date.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return `<time${className ? ` class="${className}"` : ''} datetime="${date.toISOString()}" title="${e(date.toLocaleString())}">${e(text)}</time>`;
}

export function visibleRunActivity(run) {
  const activity = (run?.messages || [])
    .filter(
      (m) =>
        ["thinking", "action", "notice", "error"].includes(m.role) && m.text,
    )
    .slice(-100);
  const allActions = activity.filter((m) => m.role !== "thinking");
  const rawActions = allActions.filter((m, idx) => !isPlumbingStep(m, allActions, idx));
  const actions = coalesceActions(rawActions);
  const reasoning = activity.filter((m) => m.role === "thinking");
  return { activity, rawActions, actions, reasoning };
}

export function runActivity(run, key, stale = false, animKeys = null) {
  const { activity, rawActions, actions, reasoning } = visibleRunActivity(run);
  const usage = run.usage || {};
  const known = (n) => Number.isFinite(n) && n >= 0;
  const number = (n) => new Intl.NumberFormat().format(n);
  const rawInput =
    usage.inputTokens ??
    (run.cumulative_in_tokens > 0 ? run.cumulative_in_tokens : null);
  const cached = known(usage.cachedInputTokens) ? usage.cachedInputTokens : 0;
  const input = known(rawInput)
    ? known(usage.inputTokens) && cached > 0 && rawInput >= cached
      ? rawInput - cached
      : rawInput
    : null;
  const output = usage.outputTokens ?? (run.cumulative_out_tokens > 0 ? run.cumulative_out_tokens : null);
  const running = run.alive || run.state === "running";
  if (!run.started_ts && !activity.length && !known(input) && !known(output))
    return "";
  const end = run.ended_ts || (running ? Date.now() / 1000 : null);
  const seconds =
    end && run.started_ts
      ? Math.max(0, Math.floor(end - run.started_ts))
      : null;
  const duration = seconds === null ? "" : formatDuration(seconds);
  const latestStep = activity.filter(m => m.role === 'thinking' || (m.role === 'action' && rawActions.includes(m))).at(-1);
  const currentAction = latestStep?.role === 'action' ? actionText(latestStep) : 'Working';
  const currentGlyph = running && !stale && latestStep?.role === 'action' ? actionIcon(latestStep) : '';
  const label = run.waiting && !running ? t("Waiting") : stale
    ? t("Last reported activity")
    : running
      ? t(currentAction)
      : status({agent:run,workspace:{jobs:[]}});
  const model = run.model ? t(run.model) : '';
  const effort = run.effort ? t(run.effort) : '';
  const speed = run.service_tier ? t(({priority:'fast',ultrafast:'ultrafast',default:'Off',standard:'Off'})[run.service_tier] || run.service_tier) : '';
  const reasoningCount = known(usage.reasoningOutputTokens) && usage.reasoningOutputTokens > 0 ? number(usage.reasoningOutputTokens) : '';
  const cacheHit = known(usage.cachedInputTokens) && known(rawInput) && rawInput > 0 && cached <= rawInput ? `${Math.round(cached / rawInput * 100)}%` : '';
  const instruments = [
    [t('Model'), model || '—', 'connections', 'model', 'model'],
    [t(effort ? 'Effort' : 'Speed'), [effort,speed].filter(Boolean).join(' · ') || '—', 'ideas', 'effort', 'effort'],
    [t('Input tokens'), known(rawInput) ? number(rawInput) : '—', 'up', 'input', 'input'],
    [t('Output tokens'), known(output) ? number(output) : '—', 'down', 'output', 'output'],
    [t('Cached input tokens'), known(usage.cachedInputTokens) ? number(cached) : '—', 'reload', 'cache', 'cached'],
    [t('Cache hit'), cacheHit || '—', 'check-circle', 'cache', 'cache-hit'],
    [t('Reasoning tokens'), reasoningCount || '—', 'ideas', 'effort', 'reasoning'],
    [t('Total tokens'), known(rawInput) && known(output) ? number(rawInput + output) : '—', 'chart', 'total', 'total'],
  ];
  const completedActions = actions.filter((m) => ["completed", "done"].includes(m.status)).length;
  const actionCount = rawActions.length || Number(run.step_count) || Number(usage.stepCount) || 0;
  const stepsSummary = `${number(actionCount)} ${t(actionCount === 1 ? 'step' : 'steps')}`;
  const speedTier = t(({priority:'Fast',ultrafast:'Ultrafast',default:'Standard',standard:'Standard'})[run.service_tier] || run.service_tier || 'Standard');
  const elapsedMarkup = duration ? `<span data-elapsed-slot="detail" data-elapsed-start="${run.started_ts}" ${running ? '' : `data-elapsed-end="${run.ended_ts || ''}"`}>${e(duration)}</span>` : '';
  const timingRows = run.started_ts ? [
    [t('Started'), timestampMarkup(run.started_ts), 'clock'],
    ...(run.ended_ts ? [[t('Finished'), timestampMarkup(run.ended_ts), 'check-circle']] : []),
    [t('Elapsed time'), elapsedMarkup, 'clock'],
    ...(!run.ended_ts ? [[t('Speed'), e(speedTier), 'activity', 'speed', speedTier]] : []),
    [t('Steps'), e(stepsSummary), 'wrench', 'steps', stepsSummary],
  ].filter(([,value])=>value) : [];
  const timings = timingRows.length ? `<dl class="activity-timings">${timingRows.map(([name,value,glyph,slot,rawVal])=>`<div${slot ? ` data-var-key="${e(key)}:time:${slot}" data-var-value="${e(rawVal)}"` : ''}><dt>${icon(glyph)}${e(name)}</dt><dd>${value}</dd></div>`).join('')}</dl>` : '';
  const state = run.waiting && !running ? "waiting" : stale
    ? "stale"
    : running
      ? "running"
      : run.state === "done"
        ? "done"
        : run.state === "error"
          ? "error"
          : "idle";
  // Counts carry their target so the page can tick them smoothly between polls.
  const badge = (name, n, direction) =>
    known(n) || running
      ? `<span class="${known(n) ? `usage-${direction}` : "usage-unreported"}" data-direction="${direction}" title="${e(name)}" aria-label="${e(name)}: ${known(n) ? number(n) : "—"}">${icon(direction === "input" ? "up" : "down")}<span ${known(n) ? `data-count="${n}" data-count-key="${e(key)}:${direction}"` : ""}>${known(n) ? number(n) : "—"}</span></span>`
      : "";
  const formatActionText = (text) => {
    const raw = String(text || "").trim();
    if (/^Using\s+tool$/i.test(raw)) return t("Using tool");
    if (/^Using\s+browser$/i.test(raw)) return t("Using browser");
    if (/^Using\s+computer$/i.test(raw)) return t("Using computer");
    const usingMatch = raw.match(/^Using\s+(.+)$/i);
    if (usingMatch) return t("Using {tool}", { tool: usingMatch[1].replace(/^`|`$/g, "") });
    return t(raw);
  };
  const fileStep = (m) => {
    if (!/^Reading file$/i.test(String(m.text || '').trim())) return null;
    const [name, ...rest] = String(m.detail || '').trim().split('\n');
    return name ? {name, extra:rest.join('\n').trim()} : null;
  };
  const renderStepContent = (m, loc, items, idx) => {
    const friendly = actionText(m);
    if (friendly !== m.text) return `<span class="step-title">${e(t(friendly))}</span>${m.detail ? `<span class="step-query" title="${e(m.detail)}">${e(m.detail)}</span>` : ''}`;
    const file=fileStep(m);
    if(file)return `<span class="step-title">${e(formatActionText(m.text))}</span><code class="step-host" title="${e(file.name)}">${e(file.name)}</code>`;
    const raw = String(m.text || "").trim();
    const toolName = inferToolName(m, items, idx);
    const wait = /^Waiting$/i.test(raw) || /(?:^|[._])job_wait$/i.test(toolName);
    if (wait) {
      const detail = String(m.detail || '').trim();
      const duration = /^(?:\d+(?:\.\d+)?\s*(?:ms|s|m|h))(?:\s+\d+\s*(?:s|m))?$/i.test(detail) ? detail : '';
      return `<span class="step-title">${e(t('Waiting'))}</span>${duration ? `<span class="step-duration">${e(duration)}</span>` : ''}`;
    }
    if (toolName && /^Using\b/i.test(raw)) {
      const subDetail = m.detail && !loc && !/\btool\s*:/i.test(m.detail) ? `<span class="step-query" title="${e(m.detail)}">${e(m.detail.length > 48 ? m.detail.slice(0, 47) + "…" : m.detail)}</span>` : "";
      return `<span class="step-title">${e(t("Using tool"))}</span><span class="step-host" title="${e(toolName)}">${e(toolName)}</span>${subDetail}`;
    }
    const isSearchQuery = !loc && m.detail && /^Searching\b/i.test(raw);
    if (isSearchQuery) {
      const q = String(m.detail).trim();
      return `<span class="step-title">${e(formatActionText(m.text))}</span><span class="step-query" title="${e(q)}">${e(q)}</span>`;
    }
    return `<span class="step-title">${e(formatActionText(m.text))}</span>${loc ? `<span class="step-host" title="${e(m.detail)}">${e(loc)}</span>` : ""}`;
  };
  const steps = (items, kindPrefix = "step") =>
    `<ol class="activity-steps">${items.map((m, idx) => {
      const loc = m.detail ? browserLocation(m.detail) : "";
      const doneStep = ["completed", "done"].includes(m.status);
      const toolName = inferToolName(m, items, idx);
      const isWait = /^Waiting$/i.test(String(m.text || '').trim()) || /(?:^|[._])job_wait$/i.test(toolName);
      const file=fileStep(m);
      const extraDetail=file ? file.extra : String(m.detail || "").trim();
      const isCommand=m.role==='action' && /^Running command\b/i.test(m.text||'') && extraDetail && !loc;
      const inlineConsumed = Boolean(isCommand || isWait || (file && !file.extra) || loc || (toolName && /^Using\b/i.test(m.text || "")) || (!loc && m.detail && /^Searching\b/i.test(m.text || "")));
      const repeatBadge = (m.repeatCount || 1) > 1 ? `<span class="step-repeat" aria-label="${e(t("Repeated {count} times", { count: m.repeatCount }))}">${m.repeatCount}</span>` : "";
      const stepAnim = animKeys?.has(`${key}:${kindPrefix}:${idx}`) ? " anim-step-in" : "";
      if (m.role === 'error') {
        const reconnect=String(m.text || '').trim().match(/^Reconnecting(?:…|\.{3})?\s*(\d+\s*\/\s*\d+)?$/i);
        const attempt=reconnect?.[1]?.replace(/\s/g,'');
        return `<li class="activity-notice${stepAnim}" data-notice="${reconnect?'reconnecting':'error'}"><span class="step-glyph">${icon(reconnect?'refresh':'warning')}</span><span class="activity-notice-copy">${e(reconnect?t('Reconnecting…'):m.text)}</span>${attempt?`<span class="activity-notice-attempt" aria-label="${e(t('Attempt {attempt}',{attempt}))}">${e(attempt)}</span>`:''}${extraDetail?`<details class="step-detail"><summary>${e(t('Details'))}${icon('chevron')}</summary><pre>${e(extraDetail)}</pre></details>`:''}</li>`;
      }
      const streamAttr = m.role === "thinking" && running
        ? ` data-stream-key="${e(key)}:thinking:${idx}"${idx === items.length - 1 ? ' data-stream-active="true"' : ""}`
        : "";
      return `<li class="activity-${e(m.role)}${stepAnim}" data-step-state="${e(m.status || "running")}">${m.role === "action" ? `<span class="step-glyph">${loc ? siteBadge(m.detail, "", "xs") : icon(actionIcon(m))}</span>` : ""}<span class="activity-kind">${m.role === "action" ? `<span title="${e(statusLabel(m.status || "running"))}">${icon(doneStep ? "check" : m.status === "failed" ? "minus" : "clock")}</span>` : t(m.role === "thinking" ? "Reasoning summary" : m.role === "error" ? "Error" : "Notice")}</span><div class="live-prose"${streamAttr}>${isCommand ? `<details class="command-step"><summary><span class="step-title">${e(formatActionText(m.text))}</span><code>${e(extraDetail)}</code></summary></details>` : m.role === "thinking" ? richText(m.text) : `${renderStepContent(m, loc, items, idx)}${repeatBadge}`}</div>${extraDetail && !inlineConsumed ? `<details class="step-detail"><summary>${e(t("Details"))}${icon("chevron")}</summary><pre>${e(extraDetail)}</pre></details>` : ""}</li>`;
    }).join("")}</ol>`;
  const actAnim = animKeys?.has(`act:${key}`) ? " anim-activity-in" : "";
  return `<details class="run-activity${actAnim}" data-state="${state}" data-running="${Boolean(running)}" data-activity="${e(key)}"><summary><span class="activity-chevron" aria-hidden="true">${icon("chevron")}</span><span class="activity-heading"><span class="activity-title">${t("Activity")}</span><span class="activity-state" title="${e(label)}">${state === "done" ? `<span class="activity-complete" aria-hidden="true">${icon("check")}</span>` : `<i aria-hidden="true"></i>`}${currentGlyph?`<span class="activity-action-icon" data-action-icon="${e(currentGlyph)}" aria-hidden="true">${icon(currentGlyph)}</span>`:''}<span class="activity-state-label">${e(label)}</span></span></span><span class="activity-meter">${badge(t("Input tokens"), input, "input")}${badge(t("Output tokens"), output, "output")}${duration ? `<span title="${t("Elapsed time")}">${icon("clock")}<span data-elapsed-start="${run.started_ts}" ${running ? "" : `data-elapsed-end="${run.ended_ts || ""}"`}>${duration}</span></span>` : ""}</span></summary><div class="activity-body">${instruments.length || timings ? `<div class="activity-telemetry"><dl class="activity-instruments">${instruments.map(([name, value, glyph, tone, slot, detail]) => `<div data-tone="${tone}" data-var-key="${e(key)}:inst:${slot}" data-var-value="${e(value)}"><dt>${icon(glyph)}${e(name)}</dt><dd>${e(value)}</dd>${detail ? `<small>${e(detail)}</small>` : ''}</div>`).join('')}</dl>${timings}</div>` : ''}${actions.length ? `<details class="activity-timeline" data-steps="${e(key)}" open><summary class="activity-section-head"><span class="activity-section-label">${icon("chevron")}<span>${t('Steps')}</span></span><span class="activity-section-count" data-var-key="${e(key)}:steps-count" data-var-value="${completedActions}/${actions.length}">${completedActions}/${actions.length}</span></summary>${steps(actions, "step")}</details>` : ''}${reasoning.length ? `<details class="reasoning-trace" data-activity="${e(key)}-reasoning"><summary>${icon("chevron")}${icon("ideas")}<span>${t("Reasoning")}</span><span class="trace-count" data-var-key="${e(key)}:trace-count" data-var-value="${reasoning.length}">${reasoning.length}</span></summary>${steps(reasoning, "think")}</details>` : ""}</div></details>`;
}
export function conversationContent(s, profile = {}, browserState = null, options = {}) {
  const animKeys = options?.newAnimKeys || null;
  const entries = [];
  const attachments = messageAttachments(s);
  for (const r of s.requests || [])
    entries.push({
      attachments: attachments.get(r.id) || [],
      contextItems:r.contextItems||[],
      time: r.created / 1000,
      id: r.id,
      role: r.id.startsWith('handback-') || r.text === 'I’m done in the browser. Continue from here.' ? 'control' : 'user',
      text:
        r.id.startsWith("approval-") &&
        r.text.startsWith("Continue with the approved action ")
          ? t("Continue with my approved action.")
          : r.text,
      note:
        r.state === "unknown"
          ? t("Delivery uncertain. Check the result before sending again.")
          : r.state === "failed"
            ? t("Not delivered: ") + t(r.result?.error || "Request refused")
            : "",
    });
  const starts = [
    ...(s.turns || []).map((t) => t.started_ts),
    s.agent.started_ts,
  ]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const finalTime = (started, ended) => {
    if (ended > started) return ended;
    const next = starts.find((time) => time > started) || Infinity;
    const corrections = (s.requests || []).filter(
      (r) =>
        r.result?.kind === "correction" &&
        r.created / 1000 >= started &&
        r.created / 1000 < next,
    );
    return (
      Math.max(started, ...corrections.map((r) => r.created / 1000)) + 0.001
    );
  };
  for (const t of s.turns || [])
    if (t.final || t.messages?.length || t.started_ts)
      entries.push({
        time: finalTime(t.started_ts, t.ended_ts),
        id: "turn-" + t.id,
        messageKey: "run-" + t.started_ts,
        started: t.started_ts,
        timestamp: t.ended_ts || t.started_ts,
        runId: t.run_id || "",
        role: "assistant",
        text: t.final,
        run: t, activityStale: false,
      });
  const current = s.agent;
  if (
    (current.final || current.started_ts) &&
    !(s.turns || []).some(
      (t) => Math.abs(t.started_ts - current.started_ts) < 0.01,
    )
  )
    entries.push({
      time: finalTime(current.started_ts, current.ended_ts),
      id: "current-" + current.started_ts,
      messageKey: "run-" + current.started_ts,
      started: current.started_ts,
      timestamp: current.ended_ts || current.started_ts,
      runId: current.run_id || "",
      role: "assistant",
      text: current.final,
      run: current, activityStale: agentStatusStale(s),
    });
  entries.sort((a, b) => a.time - b.time);
  const jobs = [...s.workspace.jobs].reverse();
  const runTurns = entries.filter((m) => m.role === "assistant" && m.started);
  const attachToTurn = (itemTime, runId) => {
    if (runId) {
      const byRun = entries.find((m) => m.role === "assistant" && m.runId === runId);
      if (byRun) return byRun;
    }
    if (Number.isFinite(itemTime) && itemTime > 0 && runTurns.length) {
      const candidates = runTurns.filter((m) => m.started <= itemTime + 1);
      return (candidates.length ? candidates : runTurns).at(-1);
    }
    return null;
  };
  for (const m of entries) m.cards = [];
  const trailingObjects = [];
  const allFileIds = new Set();
  for (const j of jobs) {
    for (const update of j.public_updates || []) {
      if (!update.text || typeof update.text !== 'string') continue;
      const target=runTurns.find(m=>m.runId && m.runId===update.run_id)
        || runTurns.find(m=>!m.runId && Number.isFinite(update.started) && Math.abs(m.started-update.started)<2);
      if (target && !target.text && (!target.progress || update.created>target.progress.created)) target.progress=update;
    }
    for (const r of latestResults(j.results)) {
      const cardAnim = animKeys?.has(`res:${r.id || r.title}`) ? "anim-card-in" : "";
      const checkoutCard = checkoutApprovalFromResult(s.id, r, j, browserState, current.alive, s.stale, cardAnim, s);
      const html = checkoutCard || resultCard(s.id, r, s.workspace.files, j.evidence || [], cardAnim);
      for (const fid of r.file_ids || []) allFileIds.add(fid);
      const target = attachToTurn(r.created, r.run_id);
      if (target) target.cards.push(html);
      else trailingObjects.push(html);
    }
    for (const a of visibleApprovals(s, j.approvals || [])) {
      const cardAnim = animKeys?.has(`app:${a.id}`) ? "anim-card-in" : "";
      const html = approvalCard(
        s.id,
        a,
        current.alive,
        s.stale,
        (j.results || []).find((r) => r.status === "confirmed" && (r.created || 0) >= (a.decided || 0)),
        cardAnim,
      );
      const target = attachToTurn(a.created, a.run_id);
      if (target) target.cards.push(html);
      else trailingObjects.push(html);
    }
  }
  for(const receipt of s.memoryReceipts || []) {
    const title=t(receipt.action==='forgotten'?'Memory removed':receipt.action==='updated'?'Memory updated':'Memory saved');
    const card=`<section class="memory-save-card" data-memory-number="${receipt.number}"><span class="memory-save-icon">${icon('ideas')}</span><div><strong>${e(title)} <span>#${e(receipt.number)}</span></strong><small>${e(t('Shared memory'))}</small>${receipt.action==='forgotten'?'':`<p>${e(receipt.text)}</p>`}</div><button type="button" class="text-button" data-feature="memory" aria-label="${e(t('Personal memory'))}">${icon('arrow')}</button></section>`;
    const target=attachToTurn(receipt.created,receipt.runId);
    if(target)target.cards.push(card);else trailingObjects.push(card);
  }
  if(s.taskSuggestion) {
    const suggestion=s.taskSuggestion;
    const card=`<section class="task-suggestion-card"><span class="task-suggestion-icon" aria-hidden="true">${icon('saved')}</span><div class="task-suggestion-body"><div class="task-suggestion-head"><strong>${e(t('Save as task?'))}</strong><span class="task-suggestion-pill">${icon('reload')}<span>${e(t('Reusable'))}</span></span></div><p class="task-suggestion-title">${e(suggestion.title)}</p><small class="task-suggestion-hint">${e(t('Run again anytime or put it on a schedule'))}</small></div><div class="task-suggestion-actions"><button type="button" class="secondary task-suggestion-save" data-feature="suggested-task" data-cid="${e(s.id)}">${icon('plus')}<span>${e(t('Save task'))}</span></button><button type="button" class="text-button task-suggestion-dismiss" data-feature="dismiss-task-suggestion" data-cid="${e(s.id)}" data-id="${e(suggestion.id)}">${e(t('Dismiss'))}</button></div></section>`;
    const target=entries.filter(entry=>entry.role==='assistant').at(-1);
    if(target)target.cards.push(card);else trailingObjects.push(card);
  }
  for (const f of standaloneFiles(s.workspace)) {
    if (allFileIds.has(f.id) || f.source === "upload") continue;
    const target = f.source && f.source !== "upload" ? attachToTurn(f.created, "") : null;
    if (target) target.cards.push(`<div class="live-files">${fileLink(s.id, f)}</div>`);
    // Unassigned files stay in the conversation collection.
  }
  const savedTasks = (s.objects || []).filter(o => o.kind === 'recipe' && !o.archived);
  const trailingTasks = [];
  for (const o of savedTasks) {
    const html = `<div class="conversation-tasks"><button class="saved-task-link" data-feature="recipe" data-cid="${e(s.id)}" data-id="${e(o.id)}">${icon('saved')}<span><small>${e(t('Saved task'))}</small><strong>${e(o.title)}</strong></span>${icon('arrow')}</button></div>`;
    const target = attachToTurn((o.updated || o.created || 0) > 1e11 ? (o.updated || o.created) / 1000 : o.updated || o.created, "");
    if (target) target.cards.push(html);
    else trailingTasks.push(o);
  }
  const terminalVisible = showTerminal(s) && !(browserState?.interactive || browserState?.pendingControl || browserState?.restoringControl);
  if (terminalVisible) {
    const run = terminalRun(s);
    entries.push({role:"terminal", time:Math.max(run.started_ts||0,s.agent?.started_ts||0) + 0.0015, run});
    entries.sort((a,b)=>a.time-b.time);
  }
  const browserStarted = browserState ? Math.max(browserState.started || 0, latestBrowserRun(s)?.started_ts || 0) : 0;
  if (!terminalVisible && s.availability !== 'missing' && browserState && entries.some(m => m.role === 'assistant' && m.started === browserStarted)) {
    const run = current.started_ts === browserStarted ? current : (s.turns || []).find(t => t.started_ts === browserStarted);
    const actionTimes = (run?.messages || []).filter(isBrowserAction).map(m => Number(m.ts) || 0);
    const browserTime=Math.max(browserStarted + 0.002, browserState.promotedAt || 0, ...actionTimes);
    const reply=entries.find(m=>m.role==='assistant'&&m.started===browserStarted);
    const caption=reply && browserTime>=reply.time ? reply.text : '';
    if(caption)reply.text='';
    entries.push({role:'browser',time:browserTime,caption,captionKey:reply?.messageKey});
    entries.sort((a,b)=>a.time-b.time);
  }
  const messages = entries
    .map((m) => {
      const render = () => {
        if (m.role === 'terminal') return `<article class="message terminal-message" data-message="terminal-${e(s.id)}">${terminalCard(s.id,m.run,{collapsed:options.terminalCollapsed,stale:s.stale})}</article>`;
        if (m.role === 'control') return `<div class="control-event" data-message="${e(m.id)}">${icon('operator')}<span>${e(t('Control returned to agent'))}</span></div>`;
        if (m.role === 'browser') return `<article class="message browser-message" data-message="browser-${e(s.id)}">${browserCard(s.id,{...browserState},Boolean(browserState.expanded),s)}${m.caption ? `<div class="bubble live-prose" data-stream-key="${e(m.captionKey)}">${richText(m.caption)}</div>` : ""}</article>`;
        const msgKey = m.messageKey || m.id;
        const msgAnim = animKeys?.has(`msg:${msgKey}`) ? " anim-msg-in" : "";
        return `<article class="message ${m.role}${msgAnim}" data-message="${e(msgKey)}">${m.role === "assistant" ? `<div class="message-identity" tabindex="0">${avatarMarkup(profile)}<span class="message-name">${e(profileName(profile))}</span>${timestampMarkup(m.timestamp, "message-timestamp")}</div>` : ""}${m.run ? runActivity(m.run, msgKey, m.activityStale, animKeys) : ""}${m.progress ? `<div class="bubble live-prose run-progress" role="status" data-progress-id="${e(m.progress.id)}">${richText(m.progress.text)}</div>` : ''}${m.attachments?.length ? `<div class="message-attachments">${m.attachments.map(f=>attachmentPreview(s.id,f)).join("")}</div>` : ""}${m.text ? `<div class="bubble live-prose" ${m.role === "assistant" ? `data-stream-key="${e(msgKey)}"` : ""}>${m.role === "assistant" ? richText(m.text) : e(m.text)}${m.role === "user" ? timestampMarkup(m.time,"user-sent-time") : ""}</div>` : ""}${m.contextItems?.length?`<details class="message-context"><summary>Context used · ${m.contextItems.length}</summary>${m.contextItems.map(item=>`<p>${e(item.title)}</p>`).join('')}</details>`:''}${(m.cards || []).join("")}${m.note ? `<small class="delivery-note">${e(m.note)}</small>` : ""}</article>`;
      };
      // Keep the full snapshot as the input key: edits, receipts, attachments,
      // language and profile changes must invalidate a retained message.
      return options.incremental && m.role !== 'browser' && m.role !== 'terminal'
        ? { key: m.messageKey || m.id, signature: JSON.stringify([m, profile, getLanguage()]), render }
        : render();
    });
  const objects = trailingObjects.join("");
  const running = !s.stale && (current.alive || current.state === "running");
  const error = (current.messages || [])
    .filter((m) => m.role === "error")
    .at(-1)?.text;
  const taskCards = trailingTasks.length ? `<div class="conversation-tasks">${trailingTasks.map(o => `<button class="saved-task-link" data-feature="recipe" data-cid="${e(s.id)}" data-id="${e(o.id)}">${icon('saved')}<span><small>${e(t('Saved task'))}</small><strong>${e(o.title)}</strong></span>${icon('arrow')}</button>`).join('')}</div>` : '';
  const recovery = s.availability === 'missing' ? `<section class="recovery-card" role="status"><div class="object-eyebrow">${icon('file')}${t('Conversation unavailable')}</div><p>${t('Saved text is kept here. Review it in a new conversation to continue. Files may be unavailable.')}</p><button class="primary" data-live-action="recover" data-cid="${e(s.id)}">${t('Recover in new conversation')}${icon('arrow')}</button></section>` : '';
  const approvalHandlesHandoff = current.handoff?.reason === 'Complete the final step in the browser.' &&
    visibleApprovals(s).some(a => ['pending', 'approved'].includes(a.status));
  const ending = `${objects}${taskCards}${current.handoff && !approvalHandlesHandoff ? `<div class="live-result"><h3>${t("Needs your help")}</h3><p>${e(current.handoff.reason || t("Check the browser and send a message to continue."))}</p><button class="secondary" data-live-action="takeover" data-cid="${e(s.id)}">${t("Take over in browser")}</button></div>` : ""}${error && current.state === "error" ? `<div class="live-error">${e(t(error))}</div>` : ""}`;
  return options.incremental ? [recovery, ...messages, ending] : recovery + messages.join('') + ending;
}
export function ongoing(snapshots) {
  return snapshots
    .map(
      (s) =>
        `<article class="work-row"><span class="work-icon">${icon("ongoing")}</span><div class="work-copy"><button class="work-link" data-live-chat="${s.id}"><h3>${e(s.title)}</h3></button><p>${status(s)}</p></div><button class="icon-button" data-live-chat="${s.id}" aria-label="${e(t("Open conversation"))}">${icon("arrow")}</button></article>`,
    )
    .join("");
}
