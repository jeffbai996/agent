import {
  createECDH,
  createHmac,
  createCipheriv,
  randomBytes,
  generateKeyPairSync,
  createPrivateKey,
  sign,
  createHash,
} from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { failure } from "./errors.mjs";
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const decode = (s) => Buffer.from(s || "", "base64url");
export function validateSubscription(value) {
  let url;
  try {
    url = new URL(value?.endpoint);
  } catch {
    throw failure("Invalid notification subscription.");
  }
  const allowed = [
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "web.push.apple.com",
  ];
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !allowed.includes(url.hostname) ||
    url.href.length > 2048
  )
    throw failure("Unsupported notification service.");
  const pub = decode(value.keys?.p256dh),
    auth = decode(value.keys?.auth);
  if (pub.length !== 65 || pub[0] !== 4 || auth.length !== 16)
    throw failure("Invalid notification keys.");
  try {
    const ec = createECDH("prime256v1");
    ec.generateKeys();
    ec.computeSecret(pub);
  } catch {
    throw failure("Invalid notification keys.");
  }
  return {
    endpoint: url.href,
    keys: {
      p256dh: pub.toString("base64url"),
      auth: auth.toString("base64url"),
    },
  };
}
// RFC 8291 / RFC 8188: one authenticated record, with a fresh ECDH key per message.
export function encryptPush(sub, payload) {
  if (payload.length > 3000) throw Error("Notification is too large.");
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  const pub = ec.getPublicKey(),
    ua = decode(sub.keys.p256dh),
    salt = randomBytes(16);
  const shared = ec.computeSecret(ua),
    prkKey = hmac(decode(sub.keys.auth), shared);
  const ikm = hmac(
    prkKey,
    Buffer.concat([Buffer.from("WebPush: info\0"), ua, pub, Buffer.from([1])]),
  );
  const prk = hmac(salt, ikm),
    key = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(
      0,
      16,
    ),
    nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(
      0,
      12,
    );
  const cipher = createCipheriv("aes-128-gcm", key, nonce),
    rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([
    salt,
    rs,
    Buffer.from([pub.length]),
    pub,
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
export class Push {
  constructor(store, { keyPath, subject, fetcher = fetch, clock = Date.now }) {
    this.store = store;
    this.subject = subject;
    this.fetcher = fetcher;
    this.clock = clock;
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    let saved;
    try {
      saved = JSON.parse(readFileSync(keyPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const { privateKey, publicKey } = generateKeyPairSync("ec", {
          namedCurve: "prime256v1",
        }),
        jwk = publicKey.export({ format: "jwk" });
      saved = {
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
        publicKey: Buffer.concat([
          Buffer.from([4]),
          decode(jwk.x),
          decode(jwk.y),
        ]).toString("base64url"),
      };
      try {
        writeFileSync(keyPath, JSON.stringify(saved), {
          mode: 0o600,
          flag: "wx",
        });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        saved = JSON.parse(readFileSync(keyPath, "utf8"));
      }
    }
    this.privateKey = createPrivateKey(saved.privateKey);
    this.publicKey = saved.publicKey;
  }
  state(owner, endpoint) {
    return {
      available: true,
      publicKey: this.publicKey,
      subscribed: this.store
        .preferences(owner, "push-subscription")
        .some((x) => x.enabled && (!endpoint || x.endpoint === endpoint)),
    };
  }
  subscribe(owner, value) {
    const sub = validateSubscription(value),
      id = createHash("sha256").update(sub.endpoint).digest("hex");
    // A shared browser endpoint belongs to one app identity at a time.
    this.store.db
      .prepare(
        "DELETE FROM app_preferences WHERE kind='push-subscription' AND id=? AND owner<>?",
      )
      .run(id, owner);
    this.store.prefer(owner, "push-subscription", id, {
      ...sub,
      enabled: true,
      since: this.clock(),
    });
    return this.state(owner);
  }
  unsubscribe(owner, endpoint) {
    const id = createHash("sha256").update(String(endpoint)).digest("hex");
    this.store.db
      .prepare(
        "DELETE FROM app_preferences WHERE owner=? AND kind='push-subscription' AND id=?",
      )
      .run(owner, id);
    return this.state(owner);
  }
  async notify(owner, item) {
    for (const sub of this.store
      .preferences(owner, "push-subscription")
      .filter((x) => x.enabled)) {
      const id = sub.id + ":" + item.id,
        old = this.store.preference(owner, "push-delivery", id);
      if (
        old.state === "accepted" ||
        old.state === "sending" ||
        old.state === "unknown"
      )
        continue;
      if (old.next > this.clock()) continue;
      // An event older than this device's subscription is not news to it.
      if (item.time && item.time * 1000 < sub.since) continue;
      this.store.prefer(owner, "push-delivery", id, { state: "sending" });
      try {
        const endpoint = new URL(validateSubscription(sub).endpoint),
          encode = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
        const claims = encode({
          aud: endpoint.origin,
          exp: Math.floor(this.clock() / 1000) + 3600,
          sub: this.subject,
        });
        const input = encode({ typ: "JWT", alg: "ES256" }) + "." + claims,
          signature = sign("sha256", Buffer.from(input), {
            key: this.privateKey,
            dsaEncoding: "ieee-p1363",
          }).toString("base64url");
        // Keep lock-screen content generic. The destination fetches private content through Tailscale.
        const payload = Buffer.from(
          JSON.stringify({
            title: "agent",
            body: item.detail,
            url: "/#chat/" + encodeURIComponent(item.conversation),
            tag: item.id,
          }),
        );
        const r = await this.fetcher(endpoint, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Encoding": "aes128gcm",
            TTL: "86400",
            Authorization: `vapid t=${input}.${signature}, k=${this.publicKey}`,
          },
          body: encryptPush(sub, payload),
        });
        if (r.status === 404 || r.status === 410) {
          this.unsubscribe(owner, sub.endpoint);
          continue;
        }
        this.store.prefer(owner, "push-delivery", id, {
          state: r.ok ? "accepted" : "rejected",
          status: r.status,
          next: this.clock() + 300000,
        });
      } catch {
        this.store.prefer(owner, "push-delivery", id, { state: "unknown" });
      }
    }
  }
  // Events worth a lock-screen notice. Content stays generic; the destination opens the conversation.
  notifyEvent(owner, event) {
    if (event.quiet) return Promise.resolve();
    if (!["reply", "approval.pending", "handoff", "run.failed", "schedule"].includes(event.kind)) return Promise.resolve();
    return this.notify(owner, { id: event.key, detail: event.detail, conversation: event.conversation, time: event.time });
  }
}
