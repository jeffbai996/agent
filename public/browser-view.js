import {actionIcon,actionText} from './activity-icons.js';
import { escape as e, icon, siteBadge } from './components.js';
import { t } from './i18n.js';

const GUI_TOOL_RE = /browser_|playwright|computer|sandbox_window|emu_input|perceive|game_macro/i;
const stageIcon = (name) => icon(name === 'spark' ? 'sparkle' : name);

export const SANDBOX_APPS = [
  ['xfce4-terminal', 'Terminal', 'terminal'],
  ['thunar', 'Files', 'folder'],
  ['chromium-browser', 'Chromium', 'globe'],
  ['libreoffice --calc', 'LibreOffice Calc', 'table'],
  ['libreoffice --writer', 'LibreOffice Writer', 'file'],
  ['mousepad', 'Text Editor', 'edit'],
];

export function inferRunSurface(run) {
  if (!run) return '';
  if (run.surface === 'desktop-sandbox' || run.surface === 'desktop-real') return run.surface;
  if (run.surface === 'browser' && (run.requested_surface !== 'auto' || run.browser_used)) return 'browser';
  const msgs = Array.isArray(run.messages) ? run.messages : Array.isArray(run.actions) ? run.actions : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m) continue;
    const hay = `${m.tool || ''} ${m.name || ''} ${m.label || ''} ${m.text || ''} ${m.detail || ''}`;
    if (/desktop-real|host[_\s-]*desktop|windows[_\s-]*host|operator[_\s-]*desktop/i.test(hay)) return 'desktop-real';
    if (/sandbox_window|desktop-sandbox|linux[_\s-]*sandbox|xfce4|libreoffice|thunar|mousepad/i.test(hay)) return 'desktop-sandbox';
    if (/browser_|playwright|^(?:Clicking|Double-clicking|Dragging|Hovering|Scrolling|Typing|Browsing|Navigating|Switching tab|Opening tab|Going back|Going forward)\b|^https?:\/\//i.test(hay)) return 'browser';
  }
  const runHay = `${run.label || ''} ${run.detail || ''}`;
  if (/desktop-real|host[_\s-]*desktop|operator[_\s-]*desktop/i.test(runHay)) return 'desktop-real';
  if (/sandbox_window|desktop-sandbox|linux[_\s-]*sandbox/i.test(runHay)) return 'desktop-sandbox';
  return '';
}

export function stageSurface(chat, run) {
  const explicit = chat?.browser?.surface || chat?.shot?.surface || chat?.browser?.shot?.surface;
  if (explicit === 'browser' || explicit === 'desktop-sandbox' || explicit === 'desktop-real') return explicit;
  const runSurface = inferRunSurface(run) || inferRunSurface(chat?.agent);
  if (runSurface) return runSurface;
  if (chat?.surface && chat.surface !== 'auto') return chat.surface;
  return 'browser';
}

export function surfaceMeta(surface) {
  if (surface === 'desktop-sandbox') {
    return { title: 'Operator Linux', shortTitle: 'Linux', iconName: 'linux', menuIcon: 'linux', badge: 'Sandbox' };
  }
  if (surface === 'desktop-real') {
    return { title: 'Operator Desktop', shortTitle: 'Desktop', iconName: 'windows', menuIcon: 'windows', badge: 'Host PC' };
  }
  return { title: 'Operator Browser', shortTitle: 'Browser', iconName: 'operator', menuIcon: 'globe', badge: 'Browser' };
}

export function operatorSurfaceMenu(cid, surface) {
  const meta = surfaceMeta(surface);
  return `<details class="browser-tab-picker browser-surface-menu"><summary class="text-button browser-surface-trigger" aria-label="${e(t('Switch surface'))}" title="${e(t('Switch surface'))} (${e(t(meta.shortTitle))})">${stageIcon(meta.menuIcon || meta.iconName)}${icon('chevron')}</summary><div class="browser-tabs browser-surface-options" role="menu" aria-label="${e(t('Operator surface'))}">${[
    ['browser', 'Browser', 'globe'],
    ['desktop-sandbox', 'Linux', 'linux'],
    ['desktop-real', 'Desktop', 'windows'],
  ].map(([val, label, ic]) => `<button type="button" role="menuitemradio" data-live-action="stage-surface" data-surface="${val}" data-cid="${e(cid)}" aria-checked="${surface === val}" aria-pressed="${surface === val}">${stageIcon(ic)}<span>${e(t(label))}</span>${surface === val ? icon('check') : ''}</button>`).join('')}</div></details>`;
}

export function browserLocation(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      ? url.hostname + (url.pathname === '/' ? '' : url.pathname)
      : '';
  } catch {
    return '';
  }
}

export function isBrowserAction(message) {
  if (!message) return false;
  if (typeof message === 'string') return GUI_TOOL_RE.test(message);
  if (GUI_TOOL_RE.test(message.tool || '') || GUI_TOOL_RE.test(message.name || '') || GUI_TOOL_RE.test(message.label || '')) return true;
  return (message.role === 'action' || message.kind === 'action') && (
    GUI_TOOL_RE.test(message.text || '') ||
    GUI_TOOL_RE.test(message.detail || '') ||
    /^(?:Clicking|Double-clicking|Dragging|Hovering|Scrolling|Typing|Browsing|Navigating|Switching tab|Opening tab|Going back|Going forward)\b/i.test(message.text || '') ||
    /^https?:\/\//i.test(message.detail || '')
  );
}

// A restarted runner can be idle while its latest recorded turn owns a browser.
export function browserRun(snapshot) {
  const run = snapshot?.agent?.started_ts ? snapshot.agent : snapshot?.turns?.at(-1);
  if (!run) return null;
  if (run.surface === 'desktop-sandbox' || run.surface === 'desktop-real') return run;
  if (Object.hasOwn(run, 'browser_used') && run.browser_used) return run;
  if (GUI_TOOL_RE.test(run.label || '') || GUI_TOOL_RE.test(run.detail || '')) return run;
  if (Array.isArray(run.actions) && run.actions.some(isBrowserAction)) return run;
  return (
    run.handoff ||
    run.messages?.some(isBrowserAction) ||
    snapshot?.workspace?.jobs?.some((job) =>
      (job.evidence || []).some(
        (ev) => GUI_TOOL_RE.test(ev.tool || '') && ev.observed >= run.started_ts,
      ),
    )
  )
    ? run
    : null;
}

export function latestBrowserRun(snapshot) {
  const active = browserRun(snapshot);
  if (active) return active;
  const turns = snapshot?.turns || [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn && browserRun({ ...snapshot, agent: turn, turns: [] })) return turn;
  }
  return null;
}

export function browserControlRevoked(state, snapshot) {
  const agent = snapshot?.agent;
  return Boolean((state?.controlStarted && agent?.started_ts && state.controlStarted !== agent.started_ts) || ((agent?.alive || agent?.state === 'running') && !agent?.waiting));
}

export function browserCanInteract(state, snapshot) {
  if(!state?.interactive||state.pendingControl||state.shot?.cached||state.error||state.controlError)return false;
  if(state.presence && state.presence.canControl !== true)return false;
  const agent=snapshot?.agent;
  if(state.controlStarted && agent?.started_ts && state.controlStarted!==agent.started_ts)return false;
  return !((agent?.alive||agent?.state==='running')&&!agent?.waiting);
}

// In-app control panel: everything stays inside the app.
export function controlPanel(cid, snapshot, presence = null, state = null) {
  const agent = snapshot?.agent || {};
  const takeover = snapshot?.control?.takeover;
  const alive = Boolean(agent.alive || agent.state === 'running');
  const interactive = browserCanInteract(state,snapshot);
  const holder = !interactive && presence?.controller
    ? `<p class="browser-holder">${icon('pointer')}${e(t('Page controlled by {device}', { device: presence.controller }))}</p>`
    : '';
  if ((state?.pendingControl || (takeover?.state === 'pending' && alive)) && !state?.interactive) {
    return '';
  }
  const statusBanner = interactive
    ? ''
    : alive
      ? `<div class="browser-control-status"><span class="browser-control-dot" data-working="true"></span><span>${e(t('Your agent is using this page'))}</span></div>`
      : '';
  if (!interactive && !statusBanner && !holder) return '';
  return `<div class="browser-control" data-control="${interactive ? 'ready' : alive ? 'working' : 'idle'}">
    ${statusBanner || holder ? `<div class="browser-control-top">${holder || statusBanner}</div>` : ""}
    ${interactive ? `<details class="browser-input-tools"><summary data-live-action="browser-keyboard">${icon("keyboard")}${e(t("Keyboard"))}${icon("chevron")}</summary><div class="browser-interactive-bar">
      <form class="browser-type-form" data-browser-type-form="${e(cid)}">
        <span class="browser-type-icon">${icon('keyboard')}</span>
        <input type="text" class="browser-type-input" name="text" placeholder="${e(t('Type into the selected field…'))}" autocomplete="off" ${state?.steering ? 'disabled' : ''}>
        <button type="submit" class="secondary" ${state?.steering ? 'disabled' : ''} aria-label="${e(t('Send text'))}">${icon('up')}</button>
      </form>
      <div class="browser-key-pills" role="group" aria-label="${e(t('Keyboard shortcuts'))}">
        <button type="button" class="browser-key-pill" data-live-action="browser-key" data-cid="${e(cid)}" data-key="Enter">Enter</button>
        <button type="button" class="browser-key-pill" data-live-action="browser-key" data-cid="${e(cid)}" data-key="Tab">Tab</button>
        <button type="button" class="browser-key-pill" data-live-action="browser-key" data-cid="${e(cid)}" data-key="Escape">Esc</button>
      </div>
    </div></details>` : ''}
  </div>`;
}

export function browserErrorMessage(message) {
  if (/WINDOWS_ELEVATION_REQUIRED/i.test(message || '')) return t('Windows is waiting for administrator approval on the host.');
  if (/input broker|SetCursorPos|input desktop|SendInput/i.test(message || '')) return t('Windows control is unavailable. Please try again.');
  if (/temporarily unavailable|could not be reached|live browser frames unavailable/i.test(message || '')) return t('Browser connection interrupted');
  return t(message || '');
}

export function footerActivity(snapshot, interactive, pendingControl = false) {
  const agent=snapshot?.agent || {};
  let label='Ready', glyph='check-circle';
  if(pendingControl){label='Taking control…';glyph='refresh';}
  else if(interactive){label='You’re in control';glyph='pointer';}
  else if(snapshot?.agentStale || snapshot?.stale){label='Reconnecting…';glyph='refresh';}
  else if(agent.alive || agent.state==='running') {
    const last=(agent.messages || []).filter(message=>message.role==='action' || message.role==='thinking').at(-1);
    label=last?.role==='action' ? actionText(last) : 'Working';
    glyph=last?.role==='action' ? actionIcon(last) : 'operator';
  } else if(agent.waiting){label=agent.waiting.paused?'Paused for you':'Waiting';glyph='clock';}
  else if(agent.handoff){label='Needs your help';glyph='pointer';}
  else if(agent.state==='done'){label='Done';}
  else if(agent.state==='error'){label='Could not finish';glyph='warning';}
  else if(['stopped','interrupted'].includes(agent.state)){label='Stopped';glyph='stop';}
  const toolLabel = /^Using [`]?([\w.-]+)[`]?$/.exec(label);
  const displayLabel = toolLabel ? `${e(t('Using'))} <code>${e(toolLabel[1])}</code>` : e(t(label));
  return `<span class="browser-footer-activity" data-finished="${label === 'Done'}" data-action-key="${e(glyph+':'+label)}" title="${e(t(label === 'Fetching' ? 'Fetching page content without navigating the browser' : label))}">${icon(glyph)}<span class="browser-footer-action-label">${displayLabel}</span></span>`;
}

export function browserCard(cid, state = {}, expanded = false, snapshot = null) {
  let explicitRun = null;
  if (typeof cid === 'object' && cid !== null) {
    const chat = cid;
    const isStateLike = state && typeof state === 'object' && ('shot' in state || 'loading' in state || 'interactive' in state || 'manualLoading' in state);
    explicitRun = !isStateLike && state && typeof state === 'object' ? state : null;
    const opts = typeof expanded === 'object' && expanded !== null ? expanded : { expanded: Boolean(expanded) };
    snapshot = chat;
    expanded = Boolean(opts.expanded);
    cid = chat.id || opts.cid || 'chat';
    state = {
      ...(chat.browser || {}),
      ...(isStateLike ? state : {}),
      ...(opts || {}),
      shot: opts.shot || (isStateLike ? state.shot : null) || chat.browser?.shot || chat.shot || explicitRun?.shot || null,
      surface: opts.surface || (isStateLike ? state.surface : undefined) || chat.browser?.surface || explicitRun?.surface || (chat.surface && chat.surface !== 'auto' ? chat.surface : undefined),
    };
  }
  const shot = state.shot && (!state.surface || (state.shot.surface || "browser") === state.surface) ? state.shot : null;
  const protectedDesktop = (state.surface || shot?.surface) === 'desktop-real' && (shot?.desktop_state === 'awaiting_admin' || /WINDOWS_ELEVATION_REQUIRED/.test(state.error || ''));
  const frame = protectedDesktop ? '' : shot?.jpeg_b64;
  const activeRun = explicitRun || (snapshot ? latestBrowserRun(snapshot) : null);
  const surface = stageSurface(
    {
      ...(snapshot || {}),
      surface: state.surface || snapshot?.surface,
      browser: { ...(snapshot?.browser || {}), ...state, surface: state.surface || shot?.surface || snapshot?.browser?.surface },
    },
    activeRun,
  );
  const meta = surfaceMeta(surface);
  const aspect = shot?.width && shot?.height ? (shot.width / shot.height).toFixed(4) : surface === 'desktop-sandbox' ? '1.6' : (16 / 9).toFixed(4);
  const url = shot?.url && shot.url !== 'about:blank' ? shot.url : '';
  const title = shot?.url === 'about:blank' ? t('New tab') : shot?.title && shot.title !== 'about:blank' ? shot.title : '';
  const loc = url ? browserLocation(url) : '';
  const captureTimestamp = state.updated || (shot?.captured_ts ? Number(shot.captured_ts) * 1000 : 0);
  const captureDate = captureTimestamp ? new Date(captureTimestamp) : null;
  const captured = captureDate && Number.isFinite(captureDate.getTime()) ? captureDate : null;
  const ageMinutes = captured ? Math.floor((Date.now() - captured) / 60000) : 0;
  const isStale = Boolean(frame && (ageMinutes >= 2 || state.error));
  const showRefreshing = Boolean(state.loading && (!frame || state.manualLoading || isStale));

  const agent = snapshot?.agent || {};
  const interactive = browserCanInteract(state,snapshot);
  const isLive = Boolean(
    state.live ??
      (interactive ||
        (state.streaming && !shot?.cached) ||
        (snapshot
          ? activeRun
            ? activeRun.alive || activeRun.state === 'running'
            : surface !== 'browser' && (agent.alive || agent.state === 'running')
          : true)),
  );

  const pendingControl = state.pendingControl || (snapshot?.control?.takeover?.state === 'pending' && Boolean(agent.alive || agent.state === 'running'));
  const actions = (activeRun?.messages || agent.messages || []).filter(message => message.role === 'action');
  const hasInteraction = actions.some(message => GUI_TOOL_RE.test(message.tool || '') || /^(Clicking|Double-clicking|Dragging|Hovering|Scrolling|Typing|Browsing|Navigating|Switching tab|Opening tab|Going back|Going forward)\b/i.test(message.text || ''));
  const research = actions.some(message => /fetch|search|read.*url/i.test(message.text || ''));
  const missingTab = /tab.*not open|no.*tab/i.test(state.error || '');
  const closed = !isLive && missingTab && (hasInteraction || Boolean(activeRun?.browser_used));
  if (surface === 'browser' && !frame && !expanded && !interactive && !pendingControl && (closed || (research && !hasInteraction && (!state.error || missingTab)))) {
    const sources = new Map();
    for (const message of actions) {
      try { const source = new URL(message.detail); if (['https:','http:'].includes(source.protocol)) sources.set(source.hostname, source.href); } catch {}
    }
    return `<section class="browser-research"><span class="research-icon">${icon('globe')}</span><div><strong>${e(t(hasInteraction ? 'Browser session' : 'Web research'))}</strong><span>${e(t(hasInteraction ? 'Tab closed' : isLive ? 'Reading sources' : 'Sources reviewed'))}</span>${sources.size ? `<div class="research-sources">${[...sources].slice(0,4).map(([host,url])=>`<a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(host)}</a>`).join('')}</div>` : ''}</div>${icon(isLive ? 'clock' : 'check-circle')}</section>`;
  }
  const isBlankTab = Boolean(
    shot?.url?.startsWith?.('about:blank') ||
    shot?.title === 'about:blank' ||
    (frame && !url && shot?.jpeg_b64 !== 'fixture'),
  );
  if (!expanded && !interactive && !state.surface && surface === 'browser' && (isBlankTab || (!url && !frame && (!state.error || missingTab) && !activeRun?.browser_used && !hasInteraction && shot?.jpeg_b64 !== 'fixture'))) {
    return '';
  }
  const captureState = protectedDesktop ? 'admin' : showRefreshing
    ? 'loading'
    : !frame && state.error
      ? 'unavailable'
      : isStale
        ? 'stale'
        : frame
          ? isLive
            ? 'live'
            : 'captured'
          : 'loading';
  const resolutionTitle = surface === 'desktop-real' && captureState === 'live' && Number(shot?.width)>0 && Number(shot?.height)>0 ? `${shot.width} × ${shot.height}` : '';
  const status = protectedDesktop ? 'UAC' : showRefreshing
    ? 'Refreshing'
    : !frame && state.error
      ? 'Unavailable'
      : isStale
        ? 'Stale capture'
        : frame
          ? isLive
            ? 'Live'
            : 'Screenshot'
          : meta.badge;
  const clockDate = captureState === 'live' ? new Date(Math.floor(Date.now() / 1000) * 1000) : captured;
  const timeText = clockDate
    ? clockDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--:--';
  // Reserve the clock column even before capture metadata arrives.
  const footerTime = `<time ${clockDate ? `datetime="${clockDate.toISOString()}" title="${e(clockDate.toLocaleString())}" aria-label="${e(isStale ? t('Last refresh {time}', { time: timeText }) : timeText)}"` : `data-clock-placeholder="true" aria-label="${e(t('Time unavailable'))}"`}>${icon('clock')}<span class="browser-footer-time-value">${e(timeText)}</span></time>`;
  const badge = url || title ? siteBadge(url || title) : icon('globe');
  const stateIcon = protectedDesktop ? 'shield' : showRefreshing
    ? 'refresh'
    : isStale || (!frame && state.error)
      ? 'warning'
      : captureState === 'live'
        ? 'dot'
        : captureState === 'captured' ? 'camera' : '';
  const stateGlyph = stateIcon ? `<span class="browser-state-glyph">${icon(stateIcon)}</span>` : '';

  const surfaceMenu = operatorSurfaceMenu(cid, surface);

  const tabs = Array.isArray(shot?.tabs) ? shot.tabs.filter(tab => typeof tab.id === 'string') : [];
  let addressBar;
  let surfaceTools = "";
  if (surface === 'desktop-sandbox') {
    const appsMenu = `<details class="browser-tab-picker browser-tabs-menu sandbox-apps-menu"><summary class="browser-icon-btn" aria-label="${e(t('Apps'))}" title="${e(t('Apps'))}">${icon('terminal')}<span>${e(t('Apps'))}</span></summary><div class="browser-tabs" role="menu" aria-label="${e(t('Apps'))}">${SANDBOX_APPS.map(([app, label, ic]) => `<button type="button" role="menuitem" data-live-action="sandbox-app" data-app="${e(app)}" data-cid="${e(cid)}">${icon(ic)}<span>${e(t(label))}</span></button>`).join('')}<hr class="sandbox-apps-divider"><button type="button" role="menuitem" class="sandbox-reset-btn" data-live-action="sandbox-reset" data-cid="${e(cid)}">${icon('refresh')}<span>${e(t('Reset desktop'))}</span></button></div></details>`;
    const windowsMenu = tabs.length ? `<details class="browser-tab-picker browser-tabs-menu"><summary class="browser-icon-btn" aria-label="${e(t('Open windows'))}" title="${e(t('Open windows'))}">${icon('tabs')}<span>${tabs.length}</span></summary><div class="browser-tabs" role="group" aria-label="${e(t('Open windows'))}">${tabs.map((tab, idx) => `<button type="button" data-live-action="browser-tab" data-target="${e(tab.id)}" data-tab-id="${e(tab.id)}" data-tab-index="${idx}" data-cid="${e(cid)}" aria-pressed="${!!tab.active}" title="${e(tab.title || tab.id)}">${icon('terminal')}<span>${e(tab.title || tab.id)}</span>${tab.active ? icon('check') : ''}</button>`).join('')}</div></details>` : '';
    surfaceTools = appsMenu + windowsMenu;
    addressBar = "";
  } else if (surface === 'desktop-real') {
    addressBar = '';
  } else {
    const tabStrip = tabs.length ? `<details class="browser-tab-picker browser-tabs-menu"><summary class="browser-icon-btn" aria-label="${e(t('Browser tabs'))}" title="${e(t('Browser tabs'))}">${icon('tabs')}<span>${tabs.length}</span></summary><div class="browser-tabs" role="group" aria-label="${e(t('Browser tabs'))}">${tabs.map((tab, idx) => `<button type="button" data-live-action="browser-tab" data-target="${e(tab.id)}" data-tab-id="${e(tab.id)}" data-tab-index="${idx}" data-cid="${e(cid)}" aria-pressed="${!!tab.active}" title="${e(tab.url || tab.title || '')}">${siteBadge(tab.url || '')}<span>${e(tab.url === 'about:blank' ? t('New tab') : tab.title || browserLocation(tab.url) || t('Browser'))}</span>${tab.active ? icon('check') : ''}</button>`).join('')}${expanded && shot.can_create_tab ? `<button type="button" class="browser-new-tab" data-live-action="browser-tab-new" data-cid="${e(cid)}" title="${e(t('New tab'))}" aria-label="${e(t('New tab'))}">${icon('plus')}<span>${e(t('New tab'))}</span></button>` : ''}</div></details>` : '';
    addressBar = !url ? '' : expanded || interactive
      ? `<div class="browser-address browser-bar browser-address-interactive">
          <div class="browser-nav-btns">
            <button type="button" class="browser-icon-btn" ${!interactive ? 'disabled' : ''} data-live-action="browser-back" data-cid="${e(cid)}" title="${e(t('Back'))}" aria-label="${e(t('Back'))}">${icon('back')}</button>
            <button type="button" class="browser-icon-btn" ${!interactive ? 'disabled' : ''} data-live-action="browser-forward" data-cid="${e(cid)}" title="${e(t('Forward'))}" aria-label="${e(t('Forward'))}">${icon('forward')}</button>
            <button type="button" class="browser-icon-btn" data-live-action="${interactive ? 'browser-reload' : 'browser-refresh'}" data-cid="${e(cid)}" title="${e(t('Reload page'))}" aria-label="${e(t('Reload page'))}">${icon('reload')}</button>
          </div>
          <form class="browser-url-form" data-browser-url-form="${e(cid)}">
            ${badge}
            <input type="text" class="browser-url-input" ${!interactive ? 'readonly' : ''} name="url" value="${e(url || loc || '')}" placeholder="${e(t('Enter URL…'))}" aria-label="${e(t('Page URL'))}">
          </form>
          ${tabStrip}
        </div>`
      : `<div class="browser-address browser-bar">${badge}<span title="${e(url)}">${e(title || loc || t('Browser'))}</span>${loc ? `<small>${e(loc)}</small>` : ''}${tabStrip}</div>`;
  }

  const defaultLoadingText = surface === 'desktop-sandbox'
    ? 'Loading Operator Linux sandbox…'
    : surface === 'desktop-real'
      ? 'Loading Operator Desktop…'
      : 'Loading this conversation’s browser…';
  const stageContent = protectedDesktop
    ? `<div class="browser-stage browser-admin-stage" style="--browser-aspect:${aspect}" role="status"><span class="browser-admin-symbol">${icon('shield')}</span><strong>${e(t('Agent is using Windows administrator access'))}</strong><span>${e(t('For security reasons, UAC prevents Windows from streaming the screen remotely.'))}</span></div>`
    : frame
    ? `<div class="browser-stage${interactive || expanded ? ' is-interactive' : ''}" data-cid="${e(cid)}" style="--browser-aspect: ${aspect}">
        <${expanded && !interactive ? 'div' : 'button type="button"'} class="browser-frame${expanded || interactive ? ' is-interactive' : ' has-hover-controls'}" data-live-action="${interactive ? 'browser-canvas' : expanded ? 'browser-observe' : 'browser-expand'}" data-cid="${e(cid)}" aria-label="${e(t(interactive ? 'Interact with browser page' : expanded ? 'Desktop preview' : 'Expand browser'))}">
          <img src="data:image/jpeg;base64,${e(frame)}" alt="${e(t('Captured browser view for this conversation'))}" draggable="false">
          ${state.lastClick ? `<span class="browser-click-ripple" data-click-x="${state.lastClick.x}" data-click-y="${state.lastClick.y}"></span>` : ''}
          ${
            !expanded && !interactive
              ? `<span class="browser-hover-overlay" aria-hidden="true">
                  <span class="browser-hover-maximize" data-live-action="browser-expand" data-cid="${e(cid)}" title="${e(t('Open larger window'))}">${icon('maximize')}</span>
                  <span class="browser-hover-takeover" data-live-action="takeover" data-cid="${e(cid)}">${icon('pointer')}<span>${e(t('Take control'))}</span></span>
                </span>`
              : ''
          }
        </${expanded && !interactive ? 'div' : 'button'}>
      </div>`
    : `<div class="browser-placeholder" role="status">${stageIcon(meta.iconName)}<span>${e(state.error ? browserErrorMessage(state.error) : t(defaultLoadingText))}</span></div>`;

  const refreshBtn = `<span class="browser-head-refresh" aria-hidden="${captureState === 'live'}" ${captureState === 'live' ? 'inert' : ''}><button type="button" class="browser-icon-btn" data-live-action="browser-refresh" data-cid="${e(cid)}" aria-label="${e(t('Refresh view'))}" title="${e(t('Refresh view'))}" ${state.loading || captureState === 'live' ? 'disabled' : ''}>${icon('reload')}</button></span>`;

  const footerControls = `<div class="browser-footer-controls" role="group" aria-label="${e(t('Browser controls'))}">
    ${
      interactive
        ? `<button type="button" class="text-button is-active" data-live-action="handback" data-cid="${e(cid)}">${icon('sparkle')}<span>${e(t('Finish up'))}</span></button>`
        : expanded ? `<button type="button" class="text-button" data-live-action="takeover" data-cid="${e(cid)}" ${pendingControl ? 'disabled' : ''}>${icon('pointer')}<span>${e(t(pendingControl ? 'Taking control…' : 'Take control'))}</span></button>` : ''
    }
    ${!expanded && surface === "browser" ? `<button type="button" class="text-button" data-live-action="browser-back" data-cid="${e(cid)}" title="${e(t('Back'))}" aria-label="${e(t('Back'))}">${icon('back')}</button>
    ` : ''}
    ${!expanded ? `<button type="button" class="text-button browser-dock-toggle" data-live-action="browser-dock" data-cid="${e(cid)}" title="${e(t('Dock browser'))}" aria-label="${e(t('Dock browser'))}">${icon('panel-right')}</button>` : ''}
    ${!expanded ? `<button type="button" class="text-button" data-live-action="browser-expand" data-cid="${e(cid)}" title="${e(t(expanded ? 'Minimize' : 'Maximize'))}" aria-label="${e(t(expanded ? 'Minimize' : 'Expand'))}">${icon('maximize')}</button>` : ''}
    ${expanded ? `<a class="operator-native-link" aria-label="${e(t('View on Operator'))}" title="${e(t('View on Operator'))}" href="/api/conversations/${encodeURIComponent(cid)}/handoff?open=1" target="_blank" rel="noopener noreferrer">${icon('operator')}<span>${e(t('View on Operator'))}</span></a>` : ''}
    ${expanded ? refreshBtn : ""}
    ${surfaceTools}
    ${surfaceMenu}
  </div>`;

  return `<section class="operator-browser${expanded ? ' browser-expanded' : ''}${interactive ? ' browser-interactive' : ''}${state.justOpened ? ' anim-browser-pop' : ''}" data-surface="${e(surface)}" data-browser-card="${e(cid)}" data-capture-state="${captureState}" aria-busy="${showRefreshing}">${!expanded ? `<header class="browser-head"><span class="browser-label" title="${e(title)}">${stageIcon(meta.iconName)}<span>${e(t(meta.title))}</span></span><span class="browser-head-right">${refreshBtn}<span class="browser-state" data-state="${captureState}"${resolutionTitle ? ` title="${e(resolutionTitle)}"` : ''}>${stateGlyph}<span class="browser-state-text">${e(t(status))}</span></span></span></header>` : ''}${addressBar}${stageContent}${state.error && frame && !/not open/i.test(state.error) ? `<div class="browser-error" role="status">${icon("warning")}<span>${e(browserErrorMessage(state.error))}</span><button type="button" class="text-button" data-live-action="browser-refresh" data-cid="${e(cid)}">${e(t("Retry"))}</button></div>` : ''}${expanded || interactive ? controlPanel(cid, snapshot, state.presence, { ...state, interactive }) : ''}<footer><span class="browser-footer-meta">${footerTime}${footerActivity(snapshot,interactive,pendingControl)}</span>${footerControls}</footer></section>`;
}

export function browserDockExtras(cid, state = {}, snapshot = null) {
  let explicitRun = null;
  if (typeof cid === 'object' && cid !== null) {
    const chat = cid;
    const isStateLike = state && typeof state === 'object' && ('shot' in state || 'loading' in state || 'interactive' in state);
    explicitRun = !isStateLike && state && typeof state === 'object' ? state : null;
    snapshot = chat;
    cid = chat.id || 'chat';
    state = {
      ...(chat.browser || {}),
      ...(isStateLike ? state : {}),
      shot: (isStateLike ? state.shot : null) || chat.browser?.shot || chat.shot || explicitRun?.shot || null,
      surface: (isStateLike ? state.surface : undefined) || chat.browser?.surface || explicitRun?.surface || (chat.surface && chat.surface !== 'auto' ? chat.surface : undefined),
    };
  }
  const shot = state.shot;
  const url = shot?.url && shot.url !== 'about:blank' ? shot.url : '';
  const title = shot?.title && shot.title !== 'about:blank' ? shot.title : '';
  const loc = url ? browserLocation(url) : '';
  const activeRun = explicitRun || (snapshot ? latestBrowserRun(snapshot) : null);
  const surface = stageSurface(
    {
      ...(snapshot || {}),
      surface: state.surface || snapshot?.surface,
      browser: { ...(snapshot?.browser || {}), ...state, surface: state.surface || shot?.surface || snapshot?.browser?.surface },
    },
    activeRun,
  );
  const agent = snapshot?.agent || {};
  const isRunning = Boolean((activeRun && (activeRun.alive || activeRun.state === 'running')) || agent.alive || agent.state === 'running');
  const messages = activeRun?.messages || agent.messages || [];
  const actions = messages.filter(m => m.role === 'action');
  const browserSteps = actions.filter(m => isBrowserAction(m) || /fetch|search|read.*url|web/i.test((m.tool || '') + ' ' + (m.text || '')));
  const stepsToShow = (browserSteps.length ? browserSteps : actions).slice(-14);

  const tabs = Array.isArray(shot?.tabs) ? shot.tabs.filter(tab => typeof tab.id === 'string') : [];

  const stepsSection = stepsToShow.length ? `<div class="browser-dock-section browser-dock-section-steps">
    <div class="browser-dock-label"><span>${e(t('Browser activity'))}</span><span class="browser-dock-count">${browserSteps.length || actions.length}</span></div>
    <div class="browser-dock-steps" role="log" aria-label="${e(t('Browser activity'))}">
      ${stepsToShow.map((m, i) => {
        const active = isRunning && i === stepsToShow.length - 1 && m === messages.at(-1);
        const detailText = m.detail ? (browserLocation(m.detail) || String(m.detail).replace(/\s+/g, ' ').slice(0, 90)) : '';
        return `<div class="browser-dock-step${active ? ' is-active' : ''}">
          <span class="browser-dock-step-icon">${icon(actionIcon(m))}</span>
          <span class="browser-dock-step-text">${e(t(actionText(m)))}</span>
          ${detailText ? `<code class="browser-dock-step-detail" title="${e(m.detail)}">${e(detailText)}</code>` : ''}
          ${active ? '<span class="browser-dock-step-spinner" aria-hidden="true"></span>' : `<span class="browser-dock-step-done">${icon('check')}</span>`}
        </div>`;
      }).join('')}
    </div>
  </div>` : `<div class="browser-dock-section browser-dock-empty">
    <p>${e(t('Browser actions and visited pages for this conversation will appear here.'))}</p>
  </div>`;

  if (surface === 'desktop-sandbox') {
    const appsSection = `<div class="browser-dock-section">
      <div class="browser-dock-label"><span>${e(t('Apps'))}</span></div>
      <div class="browser-dock-tabs sandbox-dock-apps">
        ${SANDBOX_APPS.map(([app, label, ic]) => `<button type="button" class="browser-dock-tab" data-live-action="sandbox-app" data-app="${e(app)}" data-cid="${e(cid)}">${icon(ic)}<span class="browser-dock-tab-title">${e(t(label))}</span></button>`).join('')}
        <button type="button" class="browser-dock-tab sandbox-reset-btn" data-live-action="sandbox-reset" data-cid="${e(cid)}">${icon('refresh')}<span class="browser-dock-tab-title">${e(t('Reset desktop'))}</span></button>
      </div>
    </div>`;
    const windowsSection = tabs.length ? `<div class="browser-dock-section">
      <div class="browser-dock-label"><span>${e(t('Open windows'))}</span><span class="browser-dock-count">${tabs.length}</span></div>
      <div class="browser-dock-tabs">
        ${tabs.map((tab, idx) => `<button type="button" class="browser-dock-tab" data-live-action="browser-tab" data-tab-id="${e(tab.id)}" data-tab-index="${idx}" data-target="${e(tab.id)}" data-cid="${e(cid)}" aria-pressed="${!!tab.active}" title="${e(tab.title || tab.id)}">${icon('terminal')}<span class="browser-dock-tab-title">${e(tab.title || tab.id)}</span>${tab.active ? `<span class="browser-dock-tab-active">${e(t('Active'))}</span>` : ''}</button>`).join('')}
      </div>
    </div>` : '';
    return `<aside class="browser-dock-extras" aria-label="${e(t('Linux sandbox details'))}">${appsSection}${windowsSection}${stepsSection}</aside>`;
  }

  const sources = new Map();
  if (url) {
    try { const u = new URL(url); if (['http:', 'https:'].includes(u.protocol)) sources.set(u.hostname.replace(/^www\./, ''), u.href); } catch {}
  }
  for (const m of actions) {
    if (!m.detail) continue;
    try {
      const u = new URL(m.detail);
      if (['http:', 'https:'].includes(u.protocol)) {
        const host = u.hostname.replace(/^www\./, '');
        if (!sources.has(host)) sources.set(host, u.href);
      }
    } catch {}
  }

  const pageSection = (url || title) ? `<div class="browser-dock-section">
    <div class="browser-dock-label"><span>${e(t('Current page'))}</span>${url ? `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" class="browser-dock-ext">${e(t('Open link'))} ↗</a>` : ''}</div>
    <div class="browser-dock-page">
      ${siteBadge(url || title)}
      <div class="browser-dock-page-copy">
        <strong>${e(title || loc || t('Browser page'))}</strong>
        ${url ? `<span title="${e(url)}">${e(url)}</span>` : ''}
      </div>
    </div>
  </div>` : '';

  const tabsSection = tabs.length > 1 ? `<div class="browser-dock-section">
    <div class="browser-dock-label"><span>${e(t('Open tabs'))}</span><span class="browser-dock-count">${tabs.length}</span></div>
    <div class="browser-dock-tabs">
      ${tabs.map((tab, idx) => `<button type="button" class="browser-dock-tab" data-live-action="browser-tab" data-tab-id="${e(tab.id)}" data-tab-index="${idx}" data-target="${e(tab.id)}" data-cid="${e(cid)}" aria-pressed="${!!tab.active}" title="${e(tab.url || tab.title || '')}">${siteBadge(tab.url || '')}<span class="browser-dock-tab-title">${e(tab.url === 'about:blank' ? t('New tab') : tab.title || browserLocation(tab.url) || t('Browser'))}</span>${tab.active ? `<span class="browser-dock-tab-active">${e(t('Active'))}</span>` : ''}</button>`).join('')}
    </div>
  </div>` : '';

  const sourcesSection = sources.size > 0 ? `<div class="browser-dock-section">
    <div class="browser-dock-label"><span>${e(t('Visited sources'))}</span><span class="browser-dock-count">${sources.size}</span></div>
    <div class="browser-dock-sources">
      ${[...sources.entries()].slice(0, 8).map(([host, href]) => `<a href="${e(href)}" target="_blank" rel="noopener noreferrer" class="browser-dock-source" title="${e(href)}">${siteBadge(href)}<span>${e(host)}</span></a>`).join('')}
    </div>
  </div>` : '';

  return `<aside class="browser-dock-extras" aria-label="${e(t('Browser details'))}">${pageSection}${tabsSection}${sourcesSection}${stepsSection}</aside>`;
}
