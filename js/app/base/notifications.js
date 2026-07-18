"use strict";
/* js/app/base/notifications.js
   NOTIFICATIONS
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   NOTIFICATIONS — a task shows up on the Notification page once its
   deadline falls inside its "lead time" (and until it is completed).

   Lead time = a unit (days | hours) × a value (1 | 3 | 5). Days and
   hours are alternatives, not added together: "warn me 3 days ahead"
   or "warn me 5 hours ahead".

   The app-wide default lives in localStorage; a card may override it
   with its own rule (card.notify = { mode:'custom', unit, value }).
   A card with no `notify` field simply follows the app default.

   A card's deadline is the due date of its *current* status — the
   same date the board treats as active. If no time was given, the
   deadline is the end of that day.
   ============================================================ */
const NOTIFY_STORAGE_KEY = 'app_notify_v2';
const NOTIFY_VALUES = [1, 3, 5];
const DAY_MS = 86400000, HOUR_MS = 3600000;

// Both windows exist at once. The day window is the wider one and decides who
// appears on the Notification page; the hour window is the urgent inner ring
// that also raises a toast while the app is open.
let notifySettings = { days:1, hours:5 };

function sanitizeNotify(p){
  return {
    days:  NOTIFY_VALUES.includes(p && p.days)  ? p.days  : 1,
    hours: NOTIFY_VALUES.includes(p && p.hours) ? p.hours : 5
  };
}
function loadNotifySettings(){
  try{
    const raw = Store.getRaw(NOTIFY_STORAGE_KEY);
    if(!raw) return { days:1, hours:5 };
    return sanitizeNotify(JSON.parse(raw));
  }catch(e){
    logAppError('โหลดการตั้งค่าแจ้งเตือนไม่สำเร็จ', e);
    return { days:1, hours:5 };
  }
}
function saveNotifySettings(){
  try{ Store.setRaw(NOTIFY_STORAGE_KEY, JSON.stringify(notifySettings)); }
  catch(e){ logAppError('บันทึกการตั้งค่าแจ้งเตือนไม่สำเร็จ', e); }
}

function dayLeadMs(rule){ return rule.days * DAY_MS; }
function hourLeadMs(rule){ return rule.hours * HOUR_MS; }
function ruleLabel(rule){
  return t('notify.ruleLabel', { d:rule.days, h:rule.hours });
}
// A card's effective rule: its own override, else the app default.
function cardNotifyRule(card){
  const n = card && card.notify;
  if(n && n.mode === 'custom' && NOTIFY_VALUES.includes(n.days) && NOTIFY_VALUES.includes(n.hours)){
    return { days:n.days, hours:n.hours, custom:true };
  }
  return { days:notifySettings.days, hours:notifySettings.hours, custom:false };
}
// Which ring is this task in? Drives both the page styling and the toasts.
function notifyBucket(msLeft, rule){
  if(msLeft < 0) return 'overdue';
  if(msLeft <= hourLeadMs(rule)) return 'hour';
  return 'day';
}
// The deadline the card is actually racing towards: the due date of its
// current status if one was set, otherwise the mandatory completed-status
// date. Most cards only fill the latter, so without this fallback almost
// nothing would ever reach the Notification page.
// Untimed deadlines land at the end of their day, so a task due "today"
// isn't already late at 00:01.
function cardDeadlineParts(card, board){
  const dates = card.dueDates || {};
  const times = card.dueTimes || {};
  if(dates[card.status]) return { date: dates[card.status], time: times[card.status] || '' };
  const cs = board.completeStatus;
  if(dates[cs]) return { date: dates[cs], time: times[cs] || '' };
  return null;
}
function cardDeadline(card, board){
  const parts = cardDeadlineParts(card, board);
  if(!parts) return null;
  const [y, mo, d] = parts.date.split('-').map(Number);
  const [hh, mm] = (parts.time || '23:59').split(':').map(Number);
  if([y,mo,d,hh,mm].some(n=> !Number.isFinite(n))) return null;
  const inst = zonedInstant(y, mo, d, hh, mm);
  return isNaN(inst.getTime()) ? null : inst;
}

function humanizeDuration(ms){
  const abs = Math.abs(ms);
  const days  = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins  = Math.floor((abs % 3600000) / 60000);
  const parts = [];
  if(days)  parts.push(t('notify.nDays',  { n:days }));
  if(hours) parts.push(t('notify.nHours', { n:hours }));
  if(!days && !hours) parts.push(t('notify.nMins', { n:Math.max(mins,0) }));
  return parts.join(' ');
}

// Every non-completed card, across every room, whose deadline is within reach.
/* ============================================================
   NOTIFICATIONS — one inbox, many providers.

   The card-deadline scan below is the built-in provider. Modules (e.g.
   accounting subscriptions) register their own via registerNotifyProvider(),
   and everything funnels into one list the Notification page renders. To keep
   the page and the sidebar badge source-agnostic, every provider yields the
   same neutral item shape:

     { kind, title, subtitle, tag, when, msLeft, color, ink, onClick }

   msLeft drives sort order (most overdue first); onClick decides where a tap
   goes. The card provider fills color/ink from the card's Status; a module
   fills its own.
   ============================================================ */
const NOTIFY_PROVIDERS = [];
function registerNotifyProvider(fn){ NOTIFY_PROVIDERS.push(fn); }
window.registerNotifyProvider = registerNotifyProvider;

// Built-in: cards approaching or past their deadline, as neutral items.
function cardNotifications(){
  const now = Date.now();
  const items = [];
  rooms.forEach(room=>{
    room.cards.forEach(card=>{
      if(card.status === room.completeStatus) return;   // done = nothing to warn about
      const deadline = cardDeadline(card, room);
      if(!deadline) return;
      const rule = cardNotifyRule(card);
      const msLeft = deadline.getTime() - now;
      if(msLeft <= dayLeadMs(rule)){
        const color = room.colors[card.status] || fallbackColor();
        items.push({
          id: 'card:' + room.id + ':' + card.id,   // stable id for the announce-once set
          kind: 'card',
          bucket: notifyBucket(msLeft, rule),
          title: card.topic,
          subtitle: formatDeadline(deadline),
          tag: card.status,
          extraTag: rule.custom ? t('notify.customTag') : '',
          roomName: roomLabel(room),
          when: null,                 // computed at render from msLeft
          msLeft,
          color,
          ink: resolveInk(color, card),
          onClick: ()=> openCardModal(room, card)
        });
      }
    });
  });
  return items;
}

function collectNotifications(){
  let items = cardNotifications();
  NOTIFY_PROVIDERS.forEach(fn=>{
    try{
      const extra = fn();
      if(Array.isArray(extra)){
        // A provider may omit bucket; place it by msLeft like a card would be.
        extra.forEach(it=>{ if(!it.bucket) it.bucket = notifyBucket(it.msLeft, { days:1, hours:0 }); });
        items = items.concat(extra);
      }
    }catch(e){ logAppError('notify provider ล้มเหลว', e); }
  });
  // Most overdue first, then soonest.
  return items.sort((a,b)=> a.msLeft - b.msLeft);
}

/* ---------------- Toasts ----------------
   A toast can't be dismissed for its first 5 seconds — the ✕ is disabled
   until then. Clicking the body jumps to the Notification page.
   ---------------------------------------------------------------- */
const TOAST_LOCK_MS = 5000;
const TOAST_MAX_LINES = 3;

