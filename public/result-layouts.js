import {optionKey,optionEntries} from './option-key.js';
import {resultBlocks} from './result-blocks.js';
import {resultMedia,mediaStrip} from './result-media.js';
import {escape as e,icon,siteBadge} from './components.js';
import {t} from './i18n.js';

// Older results can be upgraded only when the table explicitly supplies routes.
function flightTable(summary='') {
 const rows=String(summary).split('\n').filter(line=>line.trim().startsWith('|')).map(line=>line.trim().replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim().replace(/\*\*/g,'')));
 const header=rows[0];
 if(!header||!/^flight$/i.test(header[0])||!/^departure date$/i.test(header[1])||!/^fare\b/i.test(header[2]))return null;
 const segments=[];let total='';
 for(const row of rows.slice(2)) {
  const route=row[0]?.match(/^([A-Z]{3})\s*(?:→|->)\s*([A-Z]{3})(?:,\s*(.*))?$/);
  if(route&&row[1]&&row[2])segments.push({from:route[1],to:route[2],departure:row[1],price:row[2],flight:route[3]||''});
  else if(/^round.trip (?:sum|total)$/i.test(row[0]))total=row[2]||'';
 }
 if(segments.some((segment,i)=>i>0&&segments[i-1].to!==segment.from))return null;
 return segments.length?{kind:'flight',segments,total,price_basis:header[2].replace(/^Fare\s*/i,'').replace(/^\(|\)$/g,'')}:null;
}
const fact=(label,value)=>value?`<div><dt>${e(t(label))}</dt><dd>${e(value)}</dd></div>`:'';
const price=p=>p.total?`<div class="special-result-price"><span>${e(t('Total'))}</span><strong>${e(p.total)}</strong>${p.price_basis?`<small>${e(p.price_basis)}</small>`:''}</div>`:'';
export function resultLayout(result, context = {}) {
 const layout=baseResultLayout(result,context);
 if(!layout)return null;
 if(['flight','stay'].includes(layout.kind)){
  const entry=optionEntries(result)[0];
  if(entry)layout.body=`<section class="comparison-option itinerary-option" data-option-key="${e(optionKey(result,entry))}" data-option-cid="${e(context.cid||'')}" data-option-result="${e(result.id||'')}">${layout.body}<div class="option-actions"><button type="button" data-option-action="select" aria-pressed="false">${icon('check')}${e(t('Shortlist'))}</button><button type="button" data-option-action="note">${e(t('Note'))}</button><button type="button" data-option-action="compare">${e(t('Compare shortlist'))}</button></div><p class="option-note" hidden></p></section>`;
 }
 return {...layout,body:layout.body+resultBlocks(result.presentation?.blocks,context)};
}
function baseResultLayout(result, context = {}) {
 const p=result.presentation||flightTable(result.summary);
 if(!p||!['flight','stay','order','product','place','home','report'].includes(p.kind))return null;
 if(p.kind==='report')return {kind:'report',glyph:'file',label:'Report',body:''};
 const safeLink = value => {try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}};
 if(['product','place','home'].includes(p.kind)) {
  if(!Array.isArray(p.entries)||!p.entries.length||p.entries.some(entry=>!entry.name))return null;
  const media=resultMedia(result,context.files);
  const entryMedia=(entry,i)=>media.entries[i]?.length?mediaStrip(context.cid,media.entries[i],entry.name,1):safeLink(entry.image_url)?`<div class="result-media-strip option-media"><div class="result-media-thumb is-external"><img data-result-media src="${e(safeLink(entry.image_url))}" alt="${e(entry.image_alt||entry.name)}" loading="lazy"><span class="media-unavailable">${icon('file')}<span>${e(t('Image unavailable'))}</span></span></div></div>`:'';
  return {mediaIds:media.entries.flat().map(file=>file.id),kind:p.kind,glyph:p.kind==='product'?'bag':p.kind==='home'?'building':'pin',label:p.kind==='product'?'Product shortlist':p.kind==='home'?'Homes':'Places',body:`<div class="comparison-options">${p.entries.map((entry,i)=>`<section class="comparison-option" data-option-key="${e(optionKey(result,entry))}" data-option-cid="${e(context.cid||'')}" data-option-result="${e(result.id||'')}" data-option-name="${e(entry.name)}" data-option-url="${e(safeLink(entry.url))}">${entryMedia(entry,i)}<h4 class="option-heading"><${p.kind==='home'?`button type="button" class="option-toggle" data-option-action="collapse" aria-expanded="true" title="${e(t('Minimize'))}"`:'div class="option-summary"'}><span class="comparison-topline"><span class="option-number">${String(i+1).padStart(2,'0')}<span class="option-index-divider" aria-hidden="true">//</span></span>${entry.tag?`<span class="option-tag" title="${e(entry.tag)}">${e(entry.tag)}</span>`:''}${entry.price?`<strong class="option-price">${e(entry.price)}</strong>`:''}</span><span class="option-name"><span>${e(entry.name)}</span>${p.kind==='home'?`<span class="option-collapse-icon" aria-hidden="true">${icon('chevron')}</span>`:''}</span>${entry.seller||entry.location?`<span class="option-location">${icon(p.kind==='product'?'bag':'pin')}${e(entry.location||entry.seller)}</span>`:''}</${p.kind==='home'?'button':'div'}></h4>${entry.attributes?.length?`<ul class="option-attributes">${entry.attributes.map(item=>`<li>${e(item)}</li>`).join('')}</ul>`:''}${entry.detail?`<p class="option-detail">${e(entry.detail)}</p>`:''}${safeLink(entry.url)?`<a class="option-open" href="${e(safeLink(entry.url))}" target="_blank" rel="noopener noreferrer">${e(t('View option'))}${icon('arrow')}</a>`:''}<div class="option-actions"><button type="button" data-option-action="select" aria-pressed="false">${icon('check')}${e(t('Shortlist'))}</button><button type="button" data-option-action="note">${icon('edit')}${e(t('Note'))}</button><button type="button" data-option-action="replace">${icon('reload')}${e(t('Find replacement'))}</button><button type="button" data-option-action="hide" hidden>${e(t('Restore'))}</button></div><p class="option-note" hidden></p></section>`).join('')}</div><div class="option-toolbar"><button type="button" data-option-action="compare">${icon('spark')}${e(t('Compare shortlist'))}</button><button type="button" data-option-action="show-hidden" aria-pressed="false" hidden>${e(t('Show hidden'))}</button><button type="button" data-option-action="map">${icon('pin')}${e(t('Map'))}</button></div>`};
 }
 const confirmed=result.status==='confirmed';
 if(p.kind==='flight') {
  if(!Array.isArray(p.segments)||!p.segments.length||p.segments.some(s=>!s.from||!s.to))return null;
  return {kind:'flight',glyph:'plane',label:confirmed?'Flight confirmed':'Flight quote',body:`<div class="flight-itinerary">${p.segments.map(s=>`<section class="flight-leg"><div class="flight-carrier">${e([s.carrier,s.flight].filter(Boolean).join(' · '))}${s.cabin?`<span>${e(s.cabin)}</span>`:''}</div><div class="flight-route"><div><strong>${e(s.from)}</strong>${s.departure?`<span>${e(s.departure)}</span>`:''}</div><div class="flight-path">${icon('plane')}</div><div><strong>${e(s.to)}</strong>${s.arrival?`<span>${e(s.arrival)}</span>`:''}</div></div>${s.price?`<div class="flight-leg-price">${e(s.price)}</div>`:''}</section>`).join('')}</div>${price(p)}`};
 }
 if(p.kind==='stay'&&p.property)return {kind:'stay',glyph:'building',label:confirmed?'Stay confirmed':'Stay option',body:`<div class="stay-property"><strong>${e(p.property)}</strong>${p.location?`<span>${icon('pin')}${e(p.location)}</span>`:''}</div><dl class="stay-dates">${fact('Check-in',p.check_in)}${fact('Check-out',p.check_out)}${fact('Room',p.room)}</dl>${price(p)}`};
 if(p.kind==='order'&&p.merchant) {
  const banner=safeLink(p.image_url),logo=safeLink(p.merchant_logo)||banner,trackUrl=safeLink(p.tracking_url);
  const platform=orderPlatformName(trackUrl);
  const hasProgress=Boolean(p.fulfillment&&['placed','preparing','shipped','out_for_delivery','delivered','cancelled'].includes(p.fulfillment));
  const avatarInner=logo?`<img data-result-media src="${e(logo)}" alt="" loading="lazy"><span class="order-merchant-fallback">${trackUrl?siteBadge(trackUrl):icon('bag')}</span>`:trackUrl?siteBadge(trackUrl):icon('bag');
  const head=`<div class="order-merchant-card${banner?' has-banner':''}">${banner?`<div class="order-hero-banner"><img data-result-media src="${e(banner)}" alt="${e(p.image_alt||p.merchant)}" loading="lazy"></div>`:''}<div class="order-merchant-row"><span class="order-merchant-avatar${logo?' has-logo':' is-icon'}">${avatarInner}</span><div class="order-merchant-info"><div class="order-merchant">${e(p.merchant)}</div>${p.location?`<div class="order-merchant-location">${icon('pin')}<span>${e(p.location)}</span></div>`:''}</div>${platform?`<span class="order-platform-pill">${siteBadge(trackUrl,'','xs')}<span>${e(platform)}</span></span>`:''}</div></div>`;
  return {kind:'order',glyph:'bag',label:confirmed?'Order confirmed':'Order summary',body:`${head}${orderProgress(p,safeLink,context,result.summary,result.confirmation)}${orderReceipt(p)}${!hasProgress&&p.delivery_estimate?`<div class="order-delivery">${icon('clock')}<span>${e(p.delivery_estimate)}</span></div>`:''}${price({...p,total:p.total||p.receipt?.total})}`};
 }
 return null;
}

function orderReceipt(p) {
 const receipt=p.receipt||{},items=Array.isArray(receipt.items)&&receipt.items.length?receipt.items:Array.isArray(p.items)?p.items.map(name=>({name})):[];
 const charges=[['Subtotal','subtotal'],['Delivery fee','delivery_fee'],['Service fee','service_fee'],['Tax','tax'],['Tip','tip'],['Discount','discount']].filter(([,key])=>receipt[key]);
 if(!items.length&&!charges.length)return '';
 return `<section class="order-receipt"><h4>${e(t('Receipt'))}</h4>${items.length?`<ul class="receipt-items">${items.map(item=>`<li><span class="receipt-quantity">${item.quantity?`${e(item.quantity)}×`:''}</span><span class="receipt-item-name"><strong>${e(item.name||'')}</strong>${item.unit_price?`<small>${e(t('{price} each',{price:item.unit_price}))}</small>`:''}${item.note?`<small>${e(item.note)}</small>`:''}</span>${item.total?`<span class="receipt-item-total">${e(item.total)}</span>`:''}</li>`).join('')}</ul>`:''}${charges.length?`<dl class="receipt-charges">${charges.map(([label,key])=>`<div><dt>${e(t(label))}</dt><dd>${e(receipt[key])}</dd></div>`).join('')}</dl>`:''}</section>`;
}

function orderPlatformName(url='') {
 if(/ubereats\.com/i.test(url))return 'Uber Eats';
 if(/doordash\.com/i.test(url))return 'DoorDash';
 if(/instacart\./i.test(url))return 'Instacart';
 if(/skipthedishes\.com/i.test(url))return 'Skip';
 if(/fantuan/i.test(url))return 'Fantuan';
 if(/amazon\./i.test(url))return 'Amazon';
 return '';
}

function parseOrderEta(p,summary='') {
 let countdown=String(p.eta_countdown||'').trim();
 let window=String(p.eta_window||'').trim();
 const raw=String(p.delivery_estimate||'').trim();
 if(raw.includes('·')) {
  for(const part of raw.split('·').map(s=>s.trim()).filter(Boolean)) {
   if(!countdown&&/\b\d+\s*(?:[–-]\s*\d+\s*)?min/i.test(part))countdown=part;
   else if(!window)window=part;
  }
 } else if(raw) {
  if(/\b\d+\s*(?:[–-]\s*\d+\s*)?min/i.test(raw)&&!/\d{1,2}:\d{2}/.test(raw))countdown=countdown||raw;
  else window=window||raw;
 }
 if(!window&&summary) {
  const m=String(summary).match(/\b(\d{1,2}:\d{2}(?:\s*[–-]\s*\d{1,2}:\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|AM|PM)(?:\s*[A-Z]{2,4})?)/);
  if(m)window=m[1];
 }
 if(!countdown&&summary) {
  const m=String(summary).match(/\b(\d+\s*(?:[–-]\s*\d+\s*)?min(?:s|utes)?(?:\s*away)?)\b/i);
  if(m)countdown=m[1];
 }
 return {window,countdown};
}

function resolveOrderStage(p,summary='',confirmation='') {
 const raw=String(p.fulfillment||'').trim();
 if(raw!=='delivered')return raw;
 const trackUrl=String(p.tracking_url||'');
 if(/concludedOrder/i.test(trackUrl))return 'delivered';
 const explicit=String(p.status_detail||p.subtitle||'').trim();
 const text=[explicit,confirmation,summary].filter(Boolean).join(' ');
 if(/\b(enjoy your order|order delivered|was delivered|delivered at)\b/i.test(text))return 'delivered';
 if(/\b(heading your way|on the way|out for delivery|approaching|picking up your order|with your order|stops? along the way)\b/i.test(text))return 'out_for_delivery';
 if(/\b(preparing your order|kitchen is preparing|wrapping up|being prepared|in the kitchen)\b/i.test(text))return 'preparing';
 return raw;
}

function orderStatusNote(p,summary='',stage='') {
 const explicit=String(p.status_detail||p.subtitle||'').trim();
 if(explicit)return explicit;
 const clean=String(summary||'').replace(/^As of [^,]+,\s*/i,'').trim();
 if(!clean)return '';
 const sentences=clean.split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
 const staleForDeliveredOrTransit=s=>['out_for_delivery','delivered'].includes(stage)&&/\b(being prepared|preparing your order|in the kitchen)\b/i.test(s);
 const chosen=sentences.find(s=>!staleForDeliveredOrTransit(s))||'';
 return chosen.length>115?chosen.slice(0,112)+'…':chosen;
}

function orderProgress(p,safeLink,context={},summary='',confirmation='') {
 const stage=resolveOrderStage(p,summary,confirmation);
 const labels={placed:'Order placed',preparing:'Preparing',shipped:'Shipped',out_for_delivery:'Out for delivery',delivered:'Delivered',cancelled:'Cancelled'};
 const isLocal=stage==='preparing'||Boolean(p.location||p.merchant_logo)||/ubereats|doordash|instacart|skip|fantuan|grubhub|deliveroo/i.test(p.tracking_url||'');
 const steps=isLocal&&stage!=='shipped'?['placed','preparing','out_for_delivery','delivered']:['placed','shipped','out_for_delivery','delivered'];
 const stepLabels={placed:'Placed',preparing:'Preparing',shipped:'Shipped',out_for_delivery:'On the way',delivered:'Delivered'};
 const index=steps.indexOf(stage);
 const live=['placed','preparing','shipped','out_for_delivery'].includes(stage);
 const badge=live?`<span class="order-live-badge"><i aria-hidden="true"></i>${e(t('Live'))}</span>`:stage==='delivered'?`<span class="order-live-badge is-complete">${icon('check')}${e(t('Completed'))}</span>`:'';
 const {window:etaWindow,countdown:etaCountdown}=parseOrderEta(p,summary);
 const note=orderStatusNote(p,summary,stage);
 const etaIsWindow=/[–-]|\bmin/i.test(etaWindow||etaCountdown);
 const etaLabel=stage==='delivered'&&!etaIsWindow?'Delivered':'Estimated arrival';
 const etaMarkup=etaWindow||etaCountdown?`<div class="order-eta-box"><span class="order-eta-label">${e(t(etaLabel))}</span><div class="order-eta-values"><strong class="order-eta-time">${e(etaWindow||etaCountdown)}</strong>${etaCountdown&&etaWindow?`<span class="order-eta-countdown">${icon('clock')}<span>${e(etaCountdown)}</span></span>`:''}</div></div>`:'';
 const progress=labels[stage]?`<div class="order-progress" data-stage="${e(stage)}" data-live="${live}"><div class="order-progress-top"><div class="order-progress-heading"><span class="order-stage-icon">${icon(stage==='delivered'?'check-circle':'clock')}</span><div class="order-stage-copy"><div class="order-stage-title-row"><strong>${e(t(labels[stage]))}</strong>${badge}</div>${note?`<p class="order-stage-note">${e(note)}</p>`:''}</div></div>${etaMarkup}</div>${index>=0?`<div class="order-progress-track" aria-hidden="true">${steps.map((_,i)=>`<i class="${i<=index?'reached':''}${i===index&&live?' is-active':''}"></i>`).join('')}</div><div class="order-progress-stages" aria-hidden="true">${steps.map((s,i)=>`<span class="${i<=index?'reached':''}${i===index?' is-current':''}">${e(t(stepLabels[s]))}</span>`).join('')}</div>`:''}</div>`:'';
 const link=safeLink(p.tracking_url);
 const refresh=labels[stage]&&context.cid?`<button type="button" class="order-refresh-button" data-live-action="refresh-order" data-cid="${e(context.cid)}">${icon('reload')}<span>${e(t('Refresh status'))}</span></button>`:'';
 const actions=link||refresh?`<div class="order-actions-row">${link?`<a class="order-track-link" href="${e(link)}" target="_blank" rel="noopener noreferrer">${icon('globe')}<span>${e(t('Track order'))}</span>${icon('arrow')}</a>`:''}${refresh}</div>`:'';
 return `${progress}${actions}`;
}
