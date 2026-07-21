/* ============================================================================
 * Firebase data layer.
 *
 * The app never talks to Firestore directly — js/app/core/store.js reads and
 * writes through a few globals, and this file fills them in:
 *
 *   window.__ssBackend  'firestore' once we are live
 *   window.__ssCache    { storageKey: rawJsonString }  — read synchronously
 *   window.__ssPersist  (key, rawStringOrNull) => void — write, fire and forget
 *   window.__storeReady  promise awaited by main.js before the first render
 *   window.__hydrateStore()  re-read everything (auth.js calls it after sign-in)
 *   window.firebaseAuth  the Auth instance auth.js signs in against
 *
 * Storage shape: collection `appdata`, one document per storage key, field `v`
 * holding the JSON string. shop.html reads the same documents directly.
 *
 * EVERYTHING GOES TO FIREBASE. The only things that stay on the device are the
 * three personal preferences store.js keeps in LOCAL_ONLY_KEYS (language,
 * light/dark, ink colour) — those are per-employee, not shop data.
 *
 * A write is therefore never allowed to fail quietly:
 *   • Firestore keeps its own durable queue (persistent local cache), so a write
 *     made offline is sent as soon as the connection returns — even after a
 *     reload.
 *   • On top of that this file retries with backoff, keeps whatever still fails
 *     in a retry list, shows a visible status pill, and warns before the tab is
 *     closed while anything is unsaved.
 *   • If Firebase cannot start at all it does NOT pretend to work: the app is
 *     put in read-only mode with a red banner, because writing to localStorage
 *     instead would silently split the data across devices.
 *
 * Documents are capped at 1 MiB by Firestore and this app stores base64 images
 * inline, so a big value is SPLIT across `v0..vN` with `parts` saying how many.
 * ==========================================================================*/

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const CHUNK = 700000;              // ~700KB of JSON per field, under the 1MiB doc cap
const MAX_TRIES = 5;

window.__ssBackend = 'local';
window.__ssCache = window.__ssCache || {};

/* ---------------- status pill + banner (only in firebase mode) ------------- */
function ui(){
  let el = document.getElementById('fbStatus');
  if(!el){
    el = document.createElement('div');
    el.id = 'fbStatus';
    el.className = 'fb-status';
    el.style.display = 'none';
    (document.body || document.documentElement).appendChild(el);
  }
  return el;
}
function setStatus(state, text, onRetry){
  const el = ui();
  el.className = 'fb-status fb-' + state;
  el.style.display = '';
  el.innerHTML = '<span class="fb-dot"></span><span class="fb-text"></span>' +
    (onRetry ? '<button type="button" class="fb-retry">Retry</button>' : '');
  el.querySelector('.fb-text').textContent = text;
  const btn = el.querySelector('.fb-retry');
  if(btn) btn.addEventListener('click', onRetry);
}
function clearStatus(){ const el = document.getElementById('fbStatus'); if(el) el.style.display = 'none'; }

if(window.APP_MODE !== 'firebase' || !window.FIREBASE_CONFIG){
  // Local development: nothing to do, resolve so main.js proceeds.
  window.__storeReady = Promise.resolve();
  window.__hydrateStore = async ()=>{};
}else{
  let db = null, fsMod = null, ready = null;
  const pending = new Map();   // key -> latest value waiting for its debounce
  const timers  = new Map();
  const failed  = new Map();   // key -> value that exhausted its retries
  const queued  = new Map();   // key -> waiting for the server, already safe on disk
  let inFlight = 0;
  let signedIn = false;        // rules reject every write until someone signs in
  const SLOW_MS = 8000;        // after this a write is "queued", not "in progress"

  const sleep = (ms)=> new Promise(r=> setTimeout(r, ms));
  const joinParts = (data)=>{
    if(!data) return null;
    if(typeof data.parts === 'number' && data.parts > 0){
      let out = '';
      for(let i = 0; i < data.parts; i++) out += (data['v' + i] || '');
      return out;
    }
    return (typeof data.v === 'undefined') ? null : data.v;
  };

  function paint(){
    if(failed.size){
      setStatus('bad', 'ยังบันทึกขึ้น Firebase ไม่สำเร็จ ' + failed.size + ' รายการ', retryFailed);
      return;
    }
    // Firestore only resolves a write once the SERVER confirms it. Offline or on a
    // slow link that promise just sits there — the data is already safe in the
    // on-disk queue, so say "waiting to sync" instead of a spinner that never ends.
    if(!signedIn && pending.size){ setStatus('wait', 'รอเข้าสู่ระบบก่อนบันทึก ' + pending.size + ' รายการ'); return; }
    if(queued.size){ setStatus('wait', 'รอซิงก์ ' + queued.size + ' รายการ (ข้อมูลถูกเก็บไว้แล้ว)'); return; }
    if(inFlight || pending.size){ setStatus('busy', 'กำลังบันทึก…'); return; }
    clearStatus();
  }

  async function boot(){
    const [{ initializeApp }, fs, authMod] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-firestore.js'),
      import(SDK + 'firebase-auth.js')
    ]);
    const app = initializeApp(window.FIREBASE_CONFIG);
    // Persistent cache = Firestore keeps unsent writes on disk and replays them
    // after a reload, which is what makes "offline for a while" survivable.
    try{
      db = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
      });
    }catch(e){
      console.warn('[firebase] persistent cache unavailable, using memory cache', e);
      db = fs.getFirestore(app);
    }
    fsMod = fs;
    window.__fs = fs;
    window.firebaseAuth = authMod.getAuth(app);
    window.__ssBackend = 'firestore';
    // Writes made before sign-in would all bounce off the rules, so hold them
    // in the pending map and release them the moment a session exists.
    authMod.onAuthStateChanged(window.firebaseAuth, (user)=>{
      signedIn = !!user;
      window.__fbSignedIn = signedIn;
      if(signedIn) releaseHeld();
    });
  }

  window.__hydrateStore = async function(){
    try{
      if(!db) await ready;
      if(!db) return;
      if(!signedIn){ console.info('[firebase] not signed in yet — skipping hydrate'); return; }
      const snap = await fsMod.getDocs(fsMod.collection(db, 'appdata'));
      const next = {};
      snap.forEach(d=>{
        const raw = joinParts(d.data());
        if(raw != null) next[d.id] = raw;
      });
      // Replace in place — store.js holds a reference to this object.
      Object.keys(window.__ssCache).forEach(k=> delete window.__ssCache[k]);
      Object.assign(window.__ssCache, next);
      console.info('[firebase] hydrated ' + Object.keys(next).length + ' keys');
    }catch(e){
      console.error('[firebase] hydrate failed', e);
      setStatus('bad', 'อ่านข้อมูลจาก Firebase ไม่สำเร็จ — ลองรีเฟรช', ()=> location.reload());
    }
  };

  async function writeOnce(key, value){
    const ref = fsMod.doc(db, 'appdata', key);
    if(value === null){ await fsMod.deleteDoc(ref); return; }
    if(value.length <= CHUNK){
      await fsMod.setDoc(ref, { v: value, parts: 0, at: Date.now() });
      return;
    }
    const payload = { parts: Math.ceil(value.length / CHUNK), v: '', at: Date.now() };
    for(let i = 0; i < payload.parts; i++) payload['v' + i] = value.slice(i * CHUNK, (i + 1) * CHUNK);
    await fsMod.setDoc(ref, payload);
  }

  async function writeWithRetries(key, value){
    for(let attempt = 1; attempt <= MAX_TRIES; attempt++){
      try{
        if(!db) await ready;
        await writeOnce(key, value);
        return true;
      }catch(e){
        if(attempt === MAX_TRIES){
          console.error('[firebase] save failed for ' + key, e);
          if(typeof window.logAppError === 'function') window.logAppError('บันทึกขึ้น Firebase ไม่สำเร็จ: ' + key, e);
          throw e;
        }
        await sleep(400 * Math.pow(2, attempt));   // 0.8s, 1.6s, 3.2s, 6.4s
      }
    }
  }

  async function push(key, value){
    let settled = false;
    inFlight++; paint();
    // Stop calling it "in progress" once it is clearly just waiting for the network.
    const slow = setTimeout(()=>{
      if(settled) return;
      inFlight--;
      queued.set(key, true);
      paint();
    }, SLOW_MS);

    try{
      await writeWithRetries(key, value);
      failed.delete(key);
      return true;
    }catch(e){
      failed.set(key, value);
      return false;
    }finally{
      settled = true;
      clearTimeout(slow);
      if(queued.has(key)) queued.delete(key); else inFlight--;
      paint();
    }
  }

  async function retryFailed(){
    const items = [...failed.entries()];
    failed.clear(); paint();
    for(const [k, v] of items) await push(k, v);
  }

  function flush(key){
    timers.delete(key);
    if(!pending.has(key)) return;
    if(!signedIn){ paint(); return; }        // keep it queued; released after sign-in
    const value = pending.get(key);
    pending.delete(key);
    push(key, value);
  }
  function releaseHeld(){
    [...pending.keys()].forEach(k=>{
      if(timers.has(k)){ clearTimeout(timers.get(k)); timers.delete(k); }
      const v = pending.get(k);
      pending.delete(k);
      push(k, v);
    });
    paint();
  }

  window.__ssPersist = function(key, value){
    if(window.__fbReadOnly){                      // never accept a write we can't send
      setStatus('bad', 'ยังไม่ได้เชื่อม Firebase — ข้อมูลจะไม่ถูกบันทึก', ()=> location.reload());
      return;
    }
    pending.set(key, value);
    paint();
    if(timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(()=> flush(key), 400));
  };

  // Anything still in the debounce window goes out immediately; if something is
  // genuinely unsaved, say so instead of losing it silently.
  window.addEventListener('beforeunload', (e)=>{
    timers.forEach((t, k)=>{ clearTimeout(t); flush(k); });
    if(failed.size || inFlight || pending.size){
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
  // Type __fbStatus() in the console to see exactly what the pill is counting.
  window.__fbStatus = ()=> ({
    signedIn,
    debouncing: [...pending.keys()],
    inFlight,
    waitingForServer: [...queued.keys()],
    failed: [...failed.keys()]
  });
  window.addEventListener('online', ()=>{ if(failed.size) retryFailed(); });
  setInterval(()=>{ if(failed.size) retryFailed(); }, 30000);

  ready = boot().catch(e=>{
    // No silent fallback to localStorage: that would hide the shop's data on one
    // machine and look like it worked.
    console.error('[firebase] init failed', e);
    window.__fbReadOnly = true;
    window.__ssBackend = 'local';
    const show = ()=> setStatus('bad', 'เชื่อม Firebase ไม่ได้ — ห้ามบันทึกข้อมูลจนกว่าจะเชื่อมได้', ()=> location.reload());
    if(document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  });
  window.__storeReady = ready;
}
