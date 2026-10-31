import {patchTerminalCard} from './terminal-view.js';
import { roll } from './rolodex.js';

function updateTimeElement(current, next) {
  // A transient metadata gap must not blank a clock already on screen.
  if (next.hasAttribute('data-clock-placeholder')) return;
  const wasPlaceholder = current.hasAttribute('data-clock-placeholder');
  current.removeAttribute('data-clock-placeholder');
  current.removeAttribute('aria-hidden');
  const currentValue = current.querySelector('.browser-footer-time-value');
  const nextValue = next.querySelector('.browser-footer-time-value');
  if (!currentValue || !nextValue) return;
  const live = current.closest('[data-capture-state]')?.dataset.captureState === 'live';
  if (live) {
    const now = new Date(Math.floor(Date.now()/1000)*1000);
    nextValue.textContent = now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    next.setAttribute('datetime', now.toISOString());
    next.setAttribute('aria-label', nextValue.textContent);
  }
  const value = nextValue.textContent;
  if (wasPlaceholder) currentValue.textContent = value;
  if ((currentValue.dataset.clockValue || currentValue.textContent) !== value) {
    if (!currentValue.dataset.rolodex) roll(currentValue, currentValue.textContent);
    roll(currentValue, value);
    currentValue.dataset.clockValue = value;
  }
  for (const name of ['datetime', 'title', 'aria-label']) current.setAttribute(name, next.getAttribute(name) || '');
}

export function updateBrowserClock(card, timestamp) {
  const current = card?.querySelector('.browser-footer-meta time');
  if (!current || !timestamp) return;
  const date = new Date(timestamp);
  if(!Number.isFinite(date.getTime()))return;
  const value = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const next = current.cloneNode(true);
  next.removeAttribute('data-clock-placeholder');
  next.setAttribute('datetime', date.toISOString());
  next.setAttribute('title', date.toLocaleString());
  next.setAttribute('aria-label', value);
  next.querySelector('.browser-footer-time-value').textContent = value;
  updateTimeElement(current, next);
}

// Live wall time has one writer, aligned to second boundaries rather than frame arrivals.
export function startBrowserClock(root = document) {
  let timer;
  const tick = () => {
    if (!document.hidden) for (const card of root.querySelectorAll('[data-capture-state="live"]')) updateBrowserClock(card, Date.now());
    timer = setTimeout(tick, 1000 - Date.now() % 1000);
  };
  tick();
  return () => clearTimeout(timer);
}

// A blank document is valid when the server identifies the selected owned tab.
export function hasBrowserFrame(shot) {
  if (!shot?.jpeg_b64) return false;
  if (shot.surface === 'desktop-sandbox' || shot.surface === 'desktop-real') return true;
  return Boolean(shot.url && !shot.url.startsWith('about:blank'));
}

export function hasNewerBrowserCapture(current, incoming) {
  const next=incoming?.shot?.captured_ts, previous=current?.shot?.captured_ts;
  if(next)return !previous || next>previous;
  return !previous && (incoming?.updated||0)>(current?.updated||0);
}

// Snapshot polling is a fallback, never a second writer over a live feed.
export function shouldSeedBrowser(current, incoming, liveReady = false) {
  if (!hasBrowserFrame(incoming?.shot)) return false;
  if (!hasBrowserFrame(current?.shot)) return true;
  if (liveReady) return false;
  if (incoming.started && current.started && incoming.started < current.started) return false;
  return hasNewerBrowserCapture(current, incoming);
}

export function newerBrowserShot(incoming, current) {
  if (incoming?.desktop_state && (!current?.captured_ts || !incoming.captured_ts || incoming.captured_ts >= current.captured_ts)) return incoming;
  if (!hasBrowserFrame(incoming)) return current || incoming;
  if (current?.jpeg_b64 && incoming.captured_ts && current.captured_ts && incoming.captured_ts < current.captured_ts) return current;
  return incoming;
}

export function patchBrowserCard(existing, next) {
  if (!existing || !next) return false;
  if ((existing.dataset.surface || "browser") !== (next.dataset.surface || "browser")) {
    existing.replaceWith(next);
    return true;
  }
  const curLabel = existing.querySelector(".browser-label");
  const nextLabel = next.querySelector(".browser-label");
  if (curLabel && nextLabel && curLabel.innerHTML !== nextLabel.innerHTML) {
    curLabel.innerHTML = nextLabel.innerHTML;
  }
  if (existing.className !== next.className) existing.className = next.className;
  existing.setAttribute('aria-busy', next.getAttribute('aria-busy') || 'false');
  if (existing.dataset.captureState !== next.dataset.captureState) {
    existing.dataset.captureState = next.dataset.captureState || "";
  }
  let curStage = existing.querySelector(".browser-stage");
  const nextStage = next.querySelector(".browser-stage");
  if(curStage && nextStage && curStage.classList.contains('browser-admin-stage') !== nextStage.classList.contains('browser-admin-stage')) {
    curStage.replaceWith(nextStage.cloneNode(true));curStage=existing.querySelector('.browser-stage');
  }
  if (curStage && nextStage) {
    const nextAspect = nextStage.style.getPropertyValue("--browser-aspect");
    if (nextAspect) curStage.style.setProperty("--browser-aspect", nextAspect);
    else curStage.style.removeProperty("--browser-aspect");
  }
  const curSwitch = existing.querySelector(".browser-surface-switch");
  const nextSwitch = next.querySelector(".browser-surface-switch");
  if (curSwitch && nextSwitch && curSwitch.innerHTML !== nextSwitch.innerHTML) {
    curSwitch.innerHTML = nextSwitch.innerHTML;
  }
  const curState = existing.querySelector(".browser-state");
  const nextState = next.querySelector(".browser-state");
  if (curState && nextState) {
    const title=nextState.getAttribute('title');
    if (title) curState.setAttribute('title',title);
    else curState.removeAttribute('title');
    if (curState.dataset.state !== nextState.dataset.state) {
      curState.dataset.state = nextState.dataset.state || "";
    }
    const curGlyph = curState.querySelector(".browser-state-glyph");
    const nextGlyph = nextState.querySelector(".browser-state-glyph");
    if (curGlyph && nextGlyph && curGlyph.innerHTML !== nextGlyph.innerHTML) {
      curGlyph.innerHTML = nextGlyph.innerHTML;
    }
    const curText = curState.querySelector(".browser-state-text");
    const nextText = nextState.querySelector(".browser-state-text");
    if (curText && nextText && curText.textContent !== nextText.textContent) {
      curText.textContent = nextText.textContent;
    }
  }
  const currentRefresh = existing.querySelector('.browser-head-refresh');
  const nextRefresh = next.querySelector('.browser-head-refresh');
  if (currentRefresh && nextRefresh) {
    currentRefresh.setAttribute('aria-hidden', nextRefresh.getAttribute('aria-hidden'));
    currentRefresh.toggleAttribute('inert', nextRefresh.hasAttribute('inert'));
    currentRefresh.querySelector('button').disabled = nextRefresh.querySelector('button').disabled;
  }
  const pickerOpen = existing.querySelector('.browser-address .browser-tab-picker')?.open;
  const surfaceMenuOpen = existing.querySelector('.browser-surface-menu')?.open;
  const curSite = existing.querySelector(".browser-address");
  const nextSite = next.querySelector(".browser-address");
  if(!curSite && nextSite)existing.insertBefore(nextSite.cloneNode(true),existing.querySelector(':scope > .browser-stage,:scope > .browser-frame,:scope > .browser-placeholder,:scope > footer'));
  else if(curSite && !nextSite)curSite.remove();
  else if (curSite && nextSite && curSite.innerHTML !== nextSite.innerHTML) {
    const field=curSite.querySelector('.browser-url-input'),focused=field===document.activeElement;
    const typed=field?.value,selection=focused?[field.selectionStart,field.selectionEnd]:null;
    curSite.innerHTML = nextSite.innerHTML;
    if(focused){const nextField=curSite.querySelector('.browser-url-input');if(nextField){nextField.value=typed;nextField.focus({preventScroll:true});nextField.setSelectionRange(...selection);}}
  }
  const address = existing.querySelector('.browser-address');
  const stage = existing.querySelector(':scope > .browser-stage,:scope > .browser-frame,:scope > .browser-placeholder');
  if (address && stage && address.nextElementSibling !== stage) existing.insertBefore(address, stage);
  const picker = existing.querySelector('.browser-address .browser-tab-picker');
  if (picker) picker.open = Boolean(pickerOpen);
  const curFooter = existing.querySelector("footer");
  const nextFooter = next.querySelector("footer");
  if (curFooter && nextFooter && curFooter.innerHTML !== nextFooter.innerHTML) {
    const before=curFooter.querySelector('.browser-footer-activity');
    const after=nextFooter.querySelector('.browser-footer-activity');
    if(before && after && before.dataset.actionKey===after.dataset.actionKey) {
      // Capture timestamps refresh independently; keep an in-flight status animation intact.
      const currentTime=curFooter.querySelector('time'),nextTime=nextFooter.querySelector('time');
      if(currentTime && nextTime)updateTimeElement(currentTime,nextTime);
      else if(currentTime)currentTime.remove();
      else if(nextTime)curFooter.querySelector('.browser-footer-meta')?.prepend(nextTime);
      const controls=curFooter.querySelector('.browser-footer-controls'),incoming=nextFooter.querySelector('.browser-footer-controls');
      if(controls && incoming && controls.outerHTML!==incoming.outerHTML)controls.replaceWith(incoming);
    } else {
      const currentTime=curFooter.querySelector('time');
      const nextTime=nextFooter.querySelector('time');
      if(currentTime && nextTime)updateTimeElement(currentTime,nextTime);
      curFooter.innerHTML=nextFooter.innerHTML;
      if(currentTime && nextTime)curFooter.querySelector('time')?.replaceWith(currentTime);
      const activity=curFooter.querySelector('.browser-footer-activity');
      if(activity && before && document.documentElement.dataset.reducedMotion!=='true' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        activity.animate([{opacity:0,transform:'translateY(4px)',filter:'blur(1.5px)'},{opacity:1,transform:'translateY(0)',filter:'blur(0)'}],{duration:400,easing:'cubic-bezier(.22,1,.36,1)'});
      }
    }
  }
  const surfaceMenu = existing.querySelector('.browser-surface-menu');
  if (surfaceMenu) surfaceMenu.open = Boolean(surfaceMenuOpen);
  const curErr = existing.querySelector(".browser-error");
  const nextErr = next.querySelector(".browser-error");
  if (curErr && nextErr) {
    if (curErr.dataset.exiting) { for (const animation of curErr.getAnimations()) animation.cancel(); delete curErr.dataset.exiting; }
    if (curErr.outerHTML !== nextErr.outerHTML) curErr.replaceWith(nextErr.cloneNode(true));
  } else if (!curErr && nextErr && curFooter) {
    existing.insertBefore(nextErr.cloneNode(true), curFooter);
  } else if (curErr && !nextErr) {
    const reduced = document.documentElement.dataset.reducedMotion === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !curErr.animate) curErr.remove();
    else if (!curErr.dataset.exiting) {
      curErr.dataset.exiting = 'true';
      const animation = curErr.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(4px)'}],{duration:160,easing:'ease-out'});
      animation.finished.then(()=>curErr.remove()).catch(()=>{});
    }
  }
  const curUrl = existing.querySelector(".browser-url");
  const nextUrl = next.querySelector(".browser-url");
  if (curUrl && nextUrl && curUrl.innerHTML !== nextUrl.innerHTML) {
    curUrl.innerHTML = nextUrl.innerHTML;
  }
  const curControl = existing.querySelector('.browser-control');
  const nextControl = next.querySelector('.browser-control');
  if (curControl && nextControl && curControl.outerHTML !== nextControl.outerHTML) {
    const replacement=nextControl.cloneNode(true);
    const fields=[...curControl.querySelectorAll('input,textarea')];
    const focused=document.activeElement;
    const focusIndex=fields.indexOf(focused);
    const selection=focusIndex>=0?[focused.selectionStart,focused.selectionEnd]:null;
    replacement.querySelectorAll('input,textarea').forEach((field,index)=>{if(fields[index])field.value=fields[index].value;});
    replacement.querySelectorAll('details').forEach((field,index)=>{field.open=curControl.querySelectorAll('details')[index]?.open||false;});
    curControl.replaceWith(replacement);
    if(focusIndex>=0){const field=replacement.querySelectorAll('input,textarea')[focusIndex];field?.focus({preventScroll:true});if(field&&selection?.[0]!==null)field.setSelectionRange(...selection);}
  }
  else if (!curControl && nextControl) existing.insertBefore(nextControl.cloneNode(true), curFooter);
  else if (curControl && !nextControl) curControl.remove();
  for (const selector of ['.browser-stage', '.browser-frame']) {
    const current = existing.querySelector(selector), incoming = next.querySelector(selector);
    if (!current || !incoming) continue;
    for (const attribute of incoming.attributes) {
      // The expanded layout owns measured dimensions; state updates only change aspect.
      if (attribute.name === 'style' && selector === '.browser-stage') continue;
      if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    }
  }
  let curFrame = existing.querySelector('.browser-frame');
  const nextFrame = next.querySelector('.browser-frame');
  if (curFrame && nextFrame && curFrame.tagName !== nextFrame.tagName) {
    const replacement = nextFrame.cloneNode(true);
    curFrame.replaceWith(replacement);
    curFrame = replacement;
  }
  if (curFrame && nextFrame) {
    for (const child of [...curFrame.children]) if (child.tagName !== 'IMG') child.remove();
    for (const child of nextFrame.children) if (child.tagName !== 'IMG') curFrame.append(child.cloneNode(true));
    const ripple=curFrame.querySelector('.browser-click-ripple'),image=curFrame.querySelector('img');
    if(ripple && image?.naturalWidth) {
      const rect=image.getBoundingClientRect(),frame=curFrame.getBoundingClientRect();
      const scale=Math.min(rect.width/image.naturalWidth,rect.height/image.naturalHeight);
      const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
      ripple.style.left=(rect.left-frame.left+(rect.width-width)/2+Number(ripple.dataset.clickX)*width)+'px';
      ripple.style.top=(rect.top-frame.top+(rect.height-height)/2+Number(ripple.dataset.clickY)*height)+'px';
    }
  }
  const curImg = existing.querySelector(".browser-frame img");
  const nextImg = next.querySelector(".browser-frame img");
  if (curImg && nextImg) {
    if (curImg.alt !== nextImg.alt) curImg.alt = nextImg.alt;
    const nextSrc = nextImg.getAttribute("src") || "";
    if (curImg.dataset.pendingSrc && curImg.dataset.pendingSrc !== nextSrc) delete curImg.dataset.pendingSrc;
    if (nextSrc && curImg.getAttribute("src") !== nextSrc && curImg.dataset.pendingSrc !== nextSrc) {
      curImg.dataset.pendingSrc = nextSrc;
      const pre = new Image();
      for (const attr of curImg.attributes) {
        if (attr.name !== 'src' && attr.name !== 'data-pending-src') pre.setAttribute(attr.name, attr.value);
      }
      const commit = () => {
        if (curImg.isConnected && curImg.dataset.pendingSrc === nextSrc) curImg.replaceWith(pre);
      };
      const reject = () => {
        if (curImg.dataset.pendingSrc === nextSrc) delete curImg.dataset.pendingSrc;
      };
      pre.src = nextSrc;
      if (typeof pre.decode === 'function') pre.decode().then(commit, reject);
      else { pre.onload = commit; pre.onerror = reject; }

    }
    return true;
  }
  const curBody = existing.querySelector(".browser-stage, .browser-placeholder");
  const nextBody = next.querySelector(".browser-stage, .browser-placeholder");
  if (curBody && nextBody && curBody.outerHTML !== nextBody.outerHTML) {
    curBody.replaceWith(nextBody);
  }
  return true;
}

const messageInputs = new WeakMap();

// Keep unchanged message bubbles and the active browser attached during repaints.
export function replaceConversationContent(container, html) {
  const previousActions=new Map([...container.querySelectorAll('.run-activity[data-activity]')].map(card=>[card.dataset.activity,card.querySelector('.activity-state-label')?.textContent]));
  const next = document.createElement('div');
  if (Array.isArray(html)) {
    const existing = new Map([...container.children].map(el => [el.dataset.message, el]));
    for (const part of html) {
      if (!part) continue;
      const previous = typeof part === 'object' && existing.get(part.key);
      if (previous && messageInputs.get(previous) === part.signature) {
        // Use a placeholder until reconciliation so retained nodes never detach.
        const placeholder = document.createElement('span');
        placeholder.retainedMessage = previous;
        next.append(placeholder);
      } else {
        const template = document.createElement('template');
        template.innerHTML = typeof part === 'string' ? part : part.render();
        if (typeof part === 'object' && template.content.firstElementChild)
          messageInputs.set(template.content.firstElementChild, part.signature);
        next.append(template.content);
      }
    }
  } else next.innerHTML = html;
  const replacements = new Map();
  const users = new Map([...container.children].filter(el => el.matches('.message.user'))
    .map(el => [el.dataset.message, el]));
  for (const child of next.children) {
    const previous = users.get(child.dataset.message);
    if (!Array.isArray(html) && child.matches('.message.user') && previous?.textContent === child.textContent) replacements.set(child, previous);
  }
  const browser = container.querySelector('.operator-browser');
  const previousBrowserNeighbor = browser?.closest('[data-message]')?.previousElementSibling?.dataset.message || '';
  const incoming = next.querySelector('.operator-browser');
  if (browser && incoming) {
    const article = browser.closest('[data-message]');
    const newArticle = incoming.closest('[data-message]');
    if (article?.parentElement === container && newArticle?.dataset.message === article.dataset.message) {
      patchBrowserCard(browser, incoming);
      const children = [...newArticle.childNodes].map(node => node === incoming ? browser : node);
      // Browser is a direct child of the message article; leave it attached.
      for (const node of [...article.childNodes]) if (node !== browser) node.remove();
      for (const node of children) {
        if (node === browser) continue;
        const afterBrowser = children.indexOf(node) > children.indexOf(browser);
        if (afterBrowser) article.append(node); else article.insertBefore(node, browser);
      }
      replacements.set(newArticle, article);
    }
  }
  const terminal = container.querySelector('.operator-terminal');
  const nextTerminal = next.querySelector('.operator-terminal');
  if (terminal && nextTerminal) {
    const article = terminal.closest('[data-message]'), nextArticle = nextTerminal.closest('[data-message]');
    if (article?.parentElement === container && article.dataset.message === nextArticle?.dataset.message) {
      patchTerminalCard(terminal, nextTerminal);
      replacements.set(nextArticle, article);
    }
  }
  const desired = [...next.childNodes].map(node => node.retainedMessage || replacements.get(node) || node);
  const retained = new Set(desired);
  for (const node of [...container.childNodes]) if (!retained.has(node)) node.remove();
  let cursor = container.firstChild;
  for (const node of desired) {
    if (node === cursor) cursor = cursor.nextSibling;
    else container.insertBefore(node, cursor);
  }
  while (cursor) { const following = cursor.nextSibling; cursor.remove(); cursor = following; }
  if (document.documentElement.dataset.reducedMotion !== 'true' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const card of container.querySelectorAll('.run-activity[data-activity]')) {
      const label=card.querySelector('.activity-state-label'),before=previousActions.get(card.dataset.activity);
      if (label && before && before !== label.textContent) label.animate(
        [{opacity:.2,transform:'translateX(4px)'},{opacity:1,transform:'translateX(0)'}],
        {duration:190,easing:'cubic-bezier(.2,.8,.2,1)'});
    }
  }
  const browserNeighbor = browser?.closest('[data-message]')?.previousElementSibling?.dataset.message || '';
  if (browser?.isConnected && browserNeighbor !== previousBrowserNeighbor && document.documentElement.dataset.reducedMotion !== 'true' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    browser.animate([{opacity:.45,filter:'blur(1px)'},{opacity:1,filter:'blur(0)'}],{duration:240,easing:'cubic-bezier(.22,1,.36,1)'});
  }
}

// Keep each nested timeline anchored independently of the conversation scroll.
export function captureActivityScroll(container) {
  return new Map([...container.querySelectorAll('.activity-steps')].filter(el=>el.closest('[data-activity]')?.open && el.closest('details')?.open).map(el=>[
    el.closest('[data-activity]').dataset.activity,
    {top:el.scrollTop, pinned:el.scrollHeight-el.scrollTop-el.clientHeight<32},
  ]));
}
export function restoreActivityScroll(container, positions, follow=true) {
  for(const el of container.querySelectorAll('.activity-steps')) {
    const state=positions.get(el.closest('[data-activity]').dataset.activity);
    if(state)el.scrollTop=follow&&state.pinned?el.scrollHeight:state.top;
    if(el.dataset)el.dataset.scrolled=el.scrollTop>2?'true':'false';
  }
}

export function browserImagePoint(image, clientX, clientY) {
  const rect=image.getBoundingClientRect();
  if(!rect.width||!rect.height||!image.naturalWidth||!image.naturalHeight)return null;
  const scale=Math.min(rect.width/image.naturalWidth,rect.height/image.naturalHeight);
  const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
  const x=(clientX-rect.left-(rect.width-width)/2)/width;
  const y=(clientY-rect.top-(rect.height-height)/2)/height;
  return x<0||x>1||y<0||y>1?null:{x,y};
}

const contentEndStates=new WeakMap();
export function isContentEndPinned(scroller) {
  return contentEndStates.get(scroller)?.pinned ?? true;
}

export function followContentEnd(scroller, {shouldFollow=()=>true,onScroll=()=>{}}={}) {
  const state={pinned:true,width:scroller.clientWidth,height:scroller.clientHeight,content:scroller.scrollHeight};
  contentEndStates.set(scroller,state);
  scroller.addEventListener('click',event=>{
    if(event.target.closest?.('details[data-activity] > summary, details[data-steps] > summary'))state.pinned=false;
  },{capture:true,passive:true});
  scroller.addEventListener('touchstart',event=>{
    if(event.target.closest?.('.run-activity[open]'))state.pinned=false;
  },{passive:true});
  scroller.addEventListener('wheel',event=>{
    if(event.deltaY<0&&!event.target.closest?.('.browser-stage'))state.pinned=false;
  },{passive:true});
  scroller.addEventListener('scroll',event=>{
    const steps=event.target?.classList?.contains('activity-steps')?event.target:null;
    if(steps)steps.dataset.scrolled=steps.scrollTop>2?'true':'false';
  },{capture:true,passive:true});
  scroller.addEventListener('scroll',()=>{
    onScroll(scroller);
    // Layout changes are not evidence that the reader scrolled away.
    if(scroller.clientWidth!==state.width||scroller.clientHeight!==state.height||scroller.scrollHeight!==state.content)return;
    state.pinned=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<2;
  },{passive:true});
  const observer=new ResizeObserver(()=>{
    if(!scroller.isConnected){observer.disconnect();return;}
    state.width=scroller.clientWidth;state.height=scroller.clientHeight;state.content=scroller.scrollHeight;
    if(state.pinned&&shouldFollow()&&scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight>.5)scroller.scrollTop=scroller.scrollHeight;
    onScroll(scroller);
  });
  observer.observe(scroller);
  if(scroller.firstElementChild)observer.observe(scroller.firstElementChild);
  return ()=>{observer.disconnect();contentEndStates.delete(scroller);};
}
