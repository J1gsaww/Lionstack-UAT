// ============================================================
// FIREBASE CONFIG + DATA LAYER BOOT
//
// Loaded (as a module) BEFORE app.js. It initialises Firestore,
// then hydrates an in-memory cache (window.__ssCache) from the
// `appdata` collection so the Base App's synchronous Store.getRaw
// keeps working. app.js awaits window.__storeReady before it reads
// anything.
//
// Data model: one document per storage key under collection
// `appdata`, shape { v: <json string> } — a direct mirror of the
// old localStorage (key -> JSON string). The async module face
// (Store.get/list/set) is unchanged because it still wraps getRaw/
// setRaw, which now read/write the cache + Firestore.
//
// Safety: if Firebase fails to init or hydrate, we fall back to
// localStorage so the app still runs. On first run, if Firestore is
// empty but localStorage has data, that data is migrated up so no
// local test data is lost.
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBBfEBrzJZ0k_U4Ch7Iis1mKpkbEFTO-KI",
  authDomain: "my-base-b5936.firebaseapp.com",
  projectId: "my-base-b5936",
  storageBucket: "my-base-b5936.firebasestorage.app",
  messagingSenderId: "125519649834",
  appId: "1:125519649834:web:2c292278b20f0f89d0f753",
  measurementId: "G-YPL8KJNC6Z"
};

const COL = 'appdata';
// Firestore document ids can't contain '/'. Our keys don't today, but encode
// defensively so a future key with a slash can't break.
const encodeKey = (k)=> k.replace(/\//g, '__SL__');
const decodeKey = (id)=> id.replace(/__SL__/g, '/');

window.__ssCache = {};        // key -> raw JSON string (mirrors old localStorage)
window.__ssBackend = 'local'; // 'firestore' once hydrated; 'local' = fallback

// Sensible no-ops for local mode; overwritten below when APP_MODE === 'firebase'.
window.__ssPersist = ()=>{};
window.__hydrateStore = async ()=>{};
window.__storeReady = Promise.resolve();

// ---- Local dev mode: don't touch Firebase at all. Store runs on localStorage,
// auth.js enters the app directly. Flip window.APP_MODE (js/env.js) to 'firebase'
// to activate everything below. ----
if(window.APP_MODE !== 'firebase'){
  console.info('[env] local mode — Firebase disabled, using localStorage');
}else{

let db = null;
try{
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  window.firebaseDb = db;
  window.firebaseAuth = getAuth(app);
}catch(e){
  console.error('Firebase init failed — staying on localStorage', e);
}

// Write-through: persist one key to Firestore (value=string) or delete (null).
// Fire-and-forget; failures are logged but never block the UI.
window.__ssPersist = function(key, value){
  if(!db || window.__ssBackend !== 'firestore') return;
  const ref = doc(db, COL, encodeKey(key));
  const p = (value == null) ? deleteDoc(ref) : setDoc(ref, { v: value });
  p.catch(e=> console.error('Firestore write failed:', key, e));
};

window.__storeReady = new Promise(res=>{ window.__storeReadyResolve = res; });

// Hydrate the cache from Firestore. Called AFTER the owner signs in (auth.js),
// because locked Security Rules require an authenticated user to read the full
// collection. Safe to call more than once; resolves window.__storeReady.
window.__hydrateStore = async function(){
  if(!db){ window.__storeReadyResolve(); return; }   // stay on localStorage fallback
  try{
    const snap = await getDocs(collection(db, COL));
    snap.forEach(d=>{
      const data = d.data();
      if(data && typeof data.v !== 'undefined') window.__ssCache[decodeKey(d.id)] = data.v;
    });
    window.__ssBackend = 'firestore';
    // First run on Firestore: seed from any existing localStorage test data.
    if(snap.empty){
      try{
        for(let i = 0; i < localStorage.length; i++){
          const k = localStorage.key(i);
          if(k == null) continue;
          const v = localStorage.getItem(k);
          window.__ssCache[k] = v;
          window.__ssPersist(k, v);
        }
      }catch(e){ console.error('localStorage → Firestore seed failed', e); }
    }
  }catch(e){
    console.error('Firestore hydrate failed — falling back to localStorage', e);
    window.__ssBackend = 'local';
  }
  window.__storeReadyResolve();
};

}   // end: if(window.APP_MODE === 'firebase')
