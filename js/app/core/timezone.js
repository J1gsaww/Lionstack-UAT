"use strict";
/* js/app/core/timezone.js
   TIME ZONE
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   TIME ZONE — every "what day is it" and "what time is the deadline"
   question is answered in the app's configured zone, not the browser's.

   Without this the app silently inherits whatever zone the machine is
   set to: a laptop left on UTC would treat 07:00 Bangkok as yesterday.
   Deadlines are stored as wall-clock text ("2026-07-15", "09:45"), so
   turning them into an instant needs the zone's offset at that moment
   — which is why the conversion goes through Intl rather than
   `new Date(str)` (that would parse in the browser's zone).
   ============================================================ */
const TZ_STORAGE_KEY = 'app_timezone_v1';
const DEFAULT_TZ = 'Asia/Bangkok';
let appTimezone = DEFAULT_TZ;

function isValidTimezone(tz){
  if(!tz) return false;
  try{ new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch(e){ return false; }
}
function loadTimezone(){
  try{
    const tz = Store.getRaw(TZ_STORAGE_KEY);
    return isValidTimezone(tz) ? tz : DEFAULT_TZ;
  }catch(e){ return DEFAULT_TZ; }
}
function saveTimezone(tz){
  try{ Store.setRaw(TZ_STORAGE_KEY, tz); }catch(e){ /* ignore */ }
}

const _tzFmtCache = {};
function tzFormatter(tz){
  if(!_tzFmtCache[tz]){
    _tzFmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12:false,
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
  }
  return _tzFmtCache[tz];
}
// The wall-clock reading of an instant, as seen in `tz`.
function zoneParts(date, tz){
  const p = {};
  tzFormatter(tz || appTimezone).formatToParts(date).forEach(x=>{ if(x.type !== 'literal') p[x.type] = x.value; });
  return { year:+p.year, month:+p.month, day:+p.day, hour:(+p.hour) % 24, minute:+p.minute, second:+p.second };
}
// How far ahead of UTC the zone is at that instant (handles DST).
function zoneOffsetMs(date, tz){
  const p = zoneParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month-1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date.getTime() - date.getMilliseconds());
}
// Wall clock in the app zone → the absolute instant it refers to.
function zonedInstant(y, mo, d, hh, mm){
  const guess = Date.UTC(y, mo-1, d, hh, mm, 0);
  let off = zoneOffsetMs(new Date(guess), appTimezone);
  off = zoneOffsetMs(new Date(guess - off), appTimezone);   // second pass settles DST edges
  return new Date(guess - off);
}
// "What calendar day is it" — in the app zone, never the browser's.
function localIso(d){
  const p = zoneParts(d || new Date(), appTimezone);
  return p.year + '-' + String(p.month).padStart(2,'0') + '-' + String(p.day).padStart(2,'0');
}
// A Date whose browser-local Y/M/D match today in the app zone. Used purely as
// a month pointer for the calendar grids, never as an instant.
function zoneTodayPointer(){
  const p = zoneParts(new Date(), appTimezone);
  return new Date(p.year, p.month-1, p.day);
}
// Anchor both dates at UTC noon so DST can never shift the day count.
function isoToUtcNoon(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return Date.UTC(y, m-1, d, 12, 0, 0);
}
function currentZoneTimeLabel(){
  const p = zoneParts(new Date(), appTimezone);
  const off = zoneOffsetMs(new Date(), appTimezone) / 3600000;
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  const utc = 'UTC' + sign + hh + (mm ? ':' + String(mm).padStart(2,'0') : '');
  return `${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')} · ${utc}`;
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

