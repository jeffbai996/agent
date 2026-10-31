import { createHash, createHmac, randomBytes } from "node:crypto";
const hash = (x) => createHash("sha256").update(x).digest("hex");
export function sign(
  secret,
  method,
  path,
  query,
  body,
  {
    timestamp = Math.floor(Date.now() / 1000),
    id = randomBytes(16).toString("hex"),
  } = {},
) {
  const principal = "agent-app",
    grant = "service",
    digest = hash(body);
  const envelope = [
    "v1",
    method,
    path,
    query,
    digest,
    String(timestamp),
    id,
    principal,
    grant,
  ].join("\n");
  return {
    "Content-Type": "application/json",
    "X-Operator-MCP-Request-Id": id,
    "X-Operator-MCP-Timestamp": String(timestamp),
    "X-Operator-MCP-Principal": principal,
    "X-Operator-MCP-Grant": grant,
    "X-Operator-MCP-Client-Label": "agent-app",
    "X-Operator-MCP-Body-SHA256": digest,
    "X-Operator-MCP-Signature": createHmac("sha256", secret)
      .update(envelope)
      .digest("base64url"),
  };
}
export class Operator {
  constructor({
    origin,
    secret,
    agent,
    model = "",
    effort = "",
    cockpitUrl = "",
  }) {
    const url = new URL(origin);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw Error("Execution backend must use loopback HTTP");
    if (Buffer.byteLength(secret || "") < 32 || !agent)
      throw Error("Execution backend credentials and agent are required");
    this.origin = url.origin;
    this.secret = secret;
    this.agent = agent;
    this.model = model;
    this.effort = effort;
    this.cockpitUrl = cockpitUrl;
  }
  async call(
    path,
    {
      method = "GET",
      data,
      signed = false,
      raw = false,
      body,
      headers = {},
      signal,
    } = {},
  ) {
    const url = new URL(path, this.origin);
    if (signed && url.search) {
      url.searchParams.sort();
      url.search = url.searchParams
        .toString()
        .replace(/%7E/g, "~")
        .replace(/\*/g, "%2A");
    }
    const content = body ?? (data === undefined ? "" : JSON.stringify(data));
    const outgoing = signed
      ? sign(this.secret, method, url.pathname, url.search.slice(1), content)
      : {
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          ...headers,
        };
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: outgoing,
        body: method === "GET" ? undefined : content,
        signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000),
        redirect: "error",
      });
    } catch {
      throw Error("The agent service could not be reached.");
    }
    if (raw && res.ok) return res;
    let result;
    try {
      result = await res.json();
    } catch {
      throw Error("The agent service returned an unreadable response.");
    }
    if (!res.ok || result.ok === false) {
      const error = Error(
        result.error || "The agent service refused the request.",
      );
      error.status = res.ok ? 502 : res.status;
      throw error;
    }
    return result;
  }
  machine(path, opts) {
    return this.call("/internal/mcp/v1/operator/" + path, {
      ...opts,
      signed: true,
    });
  }
  runContext(run_id, credential) {
    return this.machine('run-context',{method:'POST',data:{run_id,credential}});
  }
  models() {
    return this.machine("models?" + new URLSearchParams({bot:this.agent}));
  }
  context(id,data) { return this.machine('context',{method:'POST',data:{conversation_id:id,id:data.id,mode:data.mode}}); }
  appWorkspace(id, data) {
    return data
      ? this.machine("app-workspace", {
          method: "POST",
          data: { ...data, conversation_id: id },
        })
      : this.machine(
          "app-workspace?" +
            new URLSearchParams({ conversation_id: id, bot: this.agent }),
        );
  }
  appVersion(id, object, revision) {
    return this.machine(
      "app-workspace?" +
        new URLSearchParams({ conversation_id: id, id: object, revision }),
    );
  }
  async create(title) {
    return this.machine("sessions", {
      method: "POST",
      data: { title, purpose: "personal-app" },
    });
  }
  snapshot(id) {
    return this.machine(
      "agent?" + new URLSearchParams({ conversation_id: id }),
    );
  }
  workspace(id) {
    return this.machine(
      "workspace?" + new URLSearchParams({ conversation_id: id }),
    );
  }
  history(id) {
    return this.machine(
      "history?" + new URLSearchParams({ conversation_id: id }),
    );
  }
  send(id, text, active = {}, requestId = "", options = {}) {
    if (
      active &&
      typeof active === "object" &&
      !requestId &&
      options &&
      Object.keys(options).length === 0 &&
      (active.surface !== undefined ||
        active.realOk !== undefined ||
        active.real_ok !== undefined ||
        active.model !== undefined ||
        active.effort !== undefined)
    ) {
      options = active;
      active = {};
      requestId = randomBytes(8).toString("hex");
    }
    const hasSurface =
      options.surface !== undefined && options.surface !== null;
    const hasRealOk =
      options.realOk !== undefined || options.real_ok !== undefined;
    const includeSurface = hasSurface || hasRealOk;
    if (active?.alive || active?.state === "running")
      return this.machine("say", {
        method: "POST",
        data: {
          conversation_id: id,
          text,
          message_id: requestId,
          run_id: active?.run_id || "",
          client_id: "agent-app-" + id,
          device_label: "Agent app",
          ...(includeSurface
            ? {
                surface: options.surface || "",
                real_ok: Boolean(options.realOk || options.real_ok),
              }
            : {}),
        },
      });
    return this.machine("dispatch", {
      method: "POST",
      data: {
        conversation_id: id,
        bot: this.agent,
        model: options.model || this.model,
        ...(options.effort ? { effort: options.effort } : {}),
        ...(options.serviceTier ? { service_tier: options.serviceTier } : {}),
        think_harder: !!options.thinkHarder,
        workflow_kind: options.workflowKind || "general",
        ...(options.accountContext !== undefined
          ? { account_context: options.accountContext }
          : {}),
        assistant_name: options.assistantName || "",
        task: text,
        ...(includeSurface
          ? {
              surface: options.surface || "",
              real_ok: Boolean(options.realOk || options.real_ok),
            }
          : {}),
      },
    });
  }
  remove(id) {
    return this.machine('conversation', {method:'DELETE', data:{conversation_id:id}});
  }
  stop(id) {
    return this.machine("stop", {
      method: "POST",
      data: { conversation_id: id },
    });
  }
  takeover(id, action) {
    return this.machine("takeover", {
      method: "POST",
      data: { ...(action && typeof action === "object" ? action : {}), conversation_id: id, ...(action?.surface ? { surface: action.surface } : {}) },
    });
  }
  presence(id) {
    return this.machine(
      "presence?" + new URLSearchParams({ conversation_id: id, client_id: "agent-app-" + id }),
    );
  }
  approve(id, approval, fingerprint, approved, adminMinutes = 0) {
    return this.machine("approval", {
      method: "POST",
      data: {
        conversation_id: id,
        id: approval,
        fingerprint,
        approved,
        admin_minutes:adminMinutes,
        client_id: "agent-app-" + id,
        device_label: "Agent app",
      },
    });
  }
  revokeAdminAllowance(id, grantId) {
    return this.machine('approval',{method:'POST',data:{conversation_id:id,client_id:'agent-app-'+id,device_label:'Agent app',revoke_admin_allowance:grantId}});
  }
  liveFrame(id, after = '', signal = null, surface = '', maxWidth = '') {
    const params = { conversation_id: id, client_id: 'agent-app-' + id, live: '1', after };
    if (surface) params.surface = surface;
    if (maxWidth) params.max_width = String(maxWidth);
    return this.machine('look?' + new URLSearchParams(params), { signal });
  }
  look(id, action = null) {
    const params = { conversation_id: id, client_id: "agent-app-" + id };
    if (action && typeof action === "object") {
      for (const [k, v] of Object.entries(action)) {
        if (v !== undefined && v !== null && k !== "conversation_id") params[k] = String(v);
      }
    }
    return this.machine("look?" + new URLSearchParams(params));
  }
  file(id, fid) {
    return this.machine(
      "files/" +
        encodeURIComponent(fid) +
        "?" +
        new URLSearchParams({ conversation_id: id }),
      { raw: true },
    );
  }
  upload(id, file, name) {
    const query = new URLSearchParams({ conversation_id: id, name })
      .toString()
      .replace(/%7E/g, "~");
    return this.machine("upload?" + query, { method: "POST", body: file });
  }
}
