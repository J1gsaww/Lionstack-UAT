"use strict";
/* js/app/core/store.js
   STORE — data layer + core utils (uid/pagination/error badge/auth-ready)
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   STORE — the one place that knows where data physically lives.

   Nothing else in the app touches localStorage directly. The day this moves
   to Firebase, only the bodies inside Store change; every caller stays put.

   Two faces on purpose:

   • Sync  (getRaw / setRaw / removeRaw)  — for the existing Base App code,
     which is synchronous top to bottom. Making it async today, while the
     backend is still localStorage, would turn one await into a chain reaction
     through a hundred callers for no present benefit. These stay sync; the win
     now is that persistence is funnelled through one object instead of 25
     scattered localStorage calls.

   • Async (get / set / remove / list / add / usage)  — for NEW module code
     (accounting, etc.), written async from day one. Firebase calls are network
     calls that must be awaited; starting async means a module never has to be
     rewritten when the backend swaps. localStorage is synchronous, so these
     just wrap a sync body in a resolved promise for now.

   When Firebase lands, the sync face is the hard part (it has to become async
   or move behind a cache); the async face barely changes. That asymmetry is
   the whole point of pushing new work onto the async side today.
   ============================================================ */
// Small preference keys the login screen + first paint need BEFORE sign-in,
// i.e. before the Firestore cache hydrates. Mirror them to localStorage on
// every write so the pre-login screen reads fresh values, not the stale seed.
const BOOT_MIRROR_KEYS = new Set([
  'app_logo_v1', 'app_logo_style_v1', 'app_theme_v1', 'app_theme_custom_v1'
]);
// Per-user DEVICE preferences — ALWAYS localStorage, never synced to Firestore,
// so each employee's theme / light-dark / language / ink stays their own
// (not global for the whole shop).
const LOCAL_ONLY_KEYS = new Set([
  'app_lang_v1', 'app_theme_mode_v1', 'app_ink_v1'
]);

const Store = {
  /* ---- sync face: Base App ----
     Reads/writes the in-memory cache when the Firestore backend is live
     (hydrated at boot by firebase-config.js), else falls back to localStorage.
     Writes are write-through: cache updates immediately (so the caller sees the
     value synchronously) and the change is pushed to Firestore in the
     background. */
  getRaw(key){
    if(LOCAL_ONLY_KEYS.has(key)){
      try{ return localStorage.getItem(key); }catch(e){ return null; }
    }
    if(window.__ssBackend === 'firestore'){
      const v = window.__ssCache[key];
      return (typeof v === 'undefined') ? null : v;
    }
    try{ return localStorage.getItem(key); }
    catch(e){ logAppError('อ่านข้อมูลไม่สำเร็จ', e); return null; }
  },
  // Returns true on success so callers can decide whether to proceed
  // (e.g. don't paint a logo that failed to save). Throws are re-thrown so
  // quota handling upstream still fires — callers that don't care wrap in try.
  setRaw(key, value){
    if(LOCAL_ONLY_KEYS.has(key)){
      try{ localStorage.setItem(key, value); }catch(e){}
      return true;
    }
    if(window.__ssBackend === 'firestore'){
      window.__ssCache[key] = value;
      window.__ssPersist(key, value);
      if(BOOT_MIRROR_KEYS.has(key)){ try{ localStorage.setItem(key, value); }catch(e){} }
      return true;
    }
    localStorage.setItem(key, value);
    return true;
  },
  removeRaw(key){
    if(LOCAL_ONLY_KEYS.has(key)){
      try{ localStorage.removeItem(key); return true; }catch(e){ return false; }
    }
    if(window.__ssBackend === 'firestore'){
      delete window.__ssCache[key];
      window.__ssPersist(key, null);
      if(BOOT_MIRROR_KEYS.has(key)){ try{ localStorage.removeItem(key); }catch(e){} }
      return true;
    }
    try{ localStorage.removeItem(key); return true; }
    catch(e){ logAppError('ลบข้อมูลไม่สำเร็จ', e); return false; }
  },

  /* ---- async face: new modules ----
     Same storage, promise-returning shape. A module awaits these and never
     learns whether the backend is localStorage or Firestore. */
  async get(key){
    const raw = this.getRaw(key);
    return raw == null ? null : JSON.parse(raw);
  },
  async set(key, value){
    this.setRaw(key, JSON.stringify(value));
    return value;
  },
  async remove(key){
    return this.removeRaw(key);
  },

  /* A collection is stored as one JSON array under `key` for now. Under
     Firestore it becomes a subcollection — hence the id-addressable shape,
     so callers written today keep working when the backend changes. */
  async list(key){
    const raw = this.getRaw(key);
    return raw == null ? [] : JSON.parse(raw);
  },
  async add(key, item){
    const list = await this.list(key);
    const withId = item.id ? item : { ...item, id: uid() };
    list.push(withId);
    this.setRaw(key, JSON.stringify(list));
    return withId;
  },
  async update(key, id, patch){
    const list = await this.list(key);
    const i = list.findIndex(x=> x.id === id);
    if(i < 0) return null;
    list[i] = { ...list[i], ...patch, id };
    this.setRaw(key, JSON.stringify(list));
    return list[i];
  },
  async removeFrom(key, id){
    const list = await this.list(key);
    const next = list.filter(x=> x.id !== id);
    this.setRaw(key, JSON.stringify(next));
    return next.length !== list.length;
  },


};

// Small id helper for Store.add(); modules can pass their own id instead.
function uid(){
  return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Kept as thin wrappers so existing callers read unchanged; both now go
   through Store instead of touching localStorage. */
function lsLoadCollection(name){
  try{
    const raw = Store.getRaw(name);
    return raw == null ? [] : JSON.parse(raw);
  }catch(e){
    logAppError('อ่านข้อมูลไม่สำเร็จ', e);
    return [];
  }
}
function lsSaveCollection(name, list){
  Store.setRaw(name, JSON.stringify(list));
}

/* ------------------------------------------------------------
   SAVE-BUTTON GUARD — disables the button + shows a loading label
   for the duration of a save so a double-click can't fire twice.
   (Instant with localStorage, but kept so the guard already works
   once saves become real network round trips under Firebase.)
   ------------------------------------------------------------ */
async function withButtonLoading(button, loadingText, fn){
  if(button.disabled) return; // already saving — ignore extra clicks
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = loadingText;
  try{
    await fn();
  }finally{
    button.disabled = false;
    button.textContent = originalText;
  }
}

/* ------------------------------------------------------------
   GLOBAL ERROR BADGE — surfaces real error messages instead of
   making people open DevTools to see what went wrong.
   ------------------------------------------------------------ */
let errorLog = [];
function logAppError(label, err){
  console.error(label, err);
  const detail = err && err.message ? err.message : String(err || '');
  errorLog.unshift({ label, detail, time: new Date() });
  if(errorLog.length > 20) errorLog.length = 20;
  renderErrorBadge();
}
function renderErrorBadge(){
  const badge = document.getElementById('errorBadge');
  const count = document.getElementById('errorBadgeCount');
  const listEl = document.getElementById('errorBadgeList');
  if(!badge) return;
  if(errorLog.length === 0){
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'flex';
  count.textContent = errorLog.length;
  listEl.innerHTML = errorLog.map(e=>`
    <div class="error-badge-item">
      <div class="error-badge-time">${e.time.toLocaleTimeString('th-TH')} — ${escapeHtml(e.label)}</div>
      <div class="error-badge-msg">${escapeHtml(e.detail)}</div>
    </div>
  `).join('');
}

/* ------------------------------------------------------------
   AUTH GATE — resolves once the (mock) auth layer says a user is
   present. Data loading waits on this so the Firebase version can
   drop straight back in without touching the load sequence.
   ------------------------------------------------------------ */
let _authReadyResolve;
const authReadyPromise = new Promise(res => { _authReadyResolve = res; });
window.addEventListener('app-authenticated', () => _authReadyResolve(), { once:true });


/* ------------------------------------------------------------
   GENERIC PAGINATION (20 rows/page) — used by the List/Completed views.
   ------------------------------------------------------------ */
const PAGE_SIZE = 20;

function paginate(list, page, perPage = PAGE_SIZE){
  const totalPages = Math.max(1, Math.ceil(list.length / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * perPage;
  return { items: list.slice(start, start + perPage), page: safePage, totalPages };
}

function scrollMainToTop(){
  const main = document.querySelector('#jigsawRoot .main');
  if(main) main.scrollTop = 0;
}

function renderPaginationControls(containerIds, page, totalPages, onPageChange){
  containerIds.forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    if(totalPages <= 1){ el.innerHTML = ''; return; }
    el.innerHTML = `
      <button class="btn btn-ghost page-btn" ${page<=1?'disabled':''} data-dir="-1">${t('page.prev')}</button>
      <span class="page-info">${t('page.info',{p:page,t:totalPages})}</span>
      <button class="btn btn-ghost page-btn" ${page>=totalPages?'disabled':''} data-dir="1">${t('page.next')}</button>
    `;
    el.querySelectorAll('.page-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const dir = parseInt(btn.dataset.dir, 10);
        onPageChange(page + dir);
        scrollMainToTop();
      });
    });
  });
}

