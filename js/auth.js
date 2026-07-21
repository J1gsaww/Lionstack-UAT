// ============================================================
// AUTH — login gate that runs BEFORE the app is shown.
//
// LOCAL mode (APP_MODE !== 'firebase', the default now):
//   • Employees log in with their ID (username) + password, verified
//     against the Employee Management store via window.empVerifyPassword
//     (salted-SHA-256, local placeholder).
//   • "Dev Login" button → mock: grants the Developer role and enters
//     the app. This is the bootstrap path (use it on first run to create
//     employees). Wired to REAL Firebase Auth when APP_MODE='firebase'.
//
// FIREBASE mode: real Email/Password auth (dynamic-imported so local
//   mode never depends on the gstatic SDK). A Firebase sign-in maps to
//   the Developer role.
//
// The app only renders after enterApp() fires `app-authenticated`
// (app.js awaits authReadyPromise). Until then the login screen shows.
// ============================================================

function enterApp(label){
  const loginScreen = document.getElementById('loginScreen');
  const jigsawRoot = document.getElementById('jigsawRoot');
  if(loginScreen) loginScreen.style.display = 'none';
  if(jigsawRoot) jigsawRoot.style.display = 'block';
  document.body.classList.add('jigsaw-theme');

  const who = document.getElementById('jigsawLoggedInAs');
  if(who) who.textContent = label || '';
  window.currentUser = { name: label || '' };

  // Signal app.js that it's safe to render (authReadyPromise).
  window.dispatchEvent(new Event('app-authenticated'));
  if(typeof window.onJigsawRootShown === 'function') window.onJigsawRootShown();
  // On a re-login (after logout) the app is already initialised — refresh
  // the sidebar so it reflects the new session.
  if(typeof window.renderSidebar === 'function') window.renderSidebar();
}

function showLogin(){
  const loginScreen = document.getElementById('loginScreen');
  const jigsawRoot = document.getElementById('jigsawRoot');
  if(loginScreen) loginScreen.style.display = 'flex';
  if(jigsawRoot) jigsawRoot.style.display = 'none';
  document.body.classList.remove('jigsaw-theme');
}

function wireLogout(handler){
  document.querySelectorAll('.logout-btn').forEach(btn=> btn.addEventListener('click', handler));
}

// ---- LOCAL: employee id/pass + Dev Login ----
function initLocalLogin(){
  console.info('[auth] local mode — employee login gate');
  const form    = document.getElementById('loginForm');
  const userEl  = document.getElementById('loginUsername');
  const passEl  = document.getElementById('loginPassword');
  const errEl   = document.getElementById('loginError');
  const devBtn  = document.getElementById('loginDevBtn');
  const showErr = (msg)=>{ if(errEl){ errEl.textContent = msg; errEl.style.display = 'block'; } };

  showLogin();

  if(form){
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      if(errEl) errEl.style.display = 'none';
      const username = userEl ? userEl.value.trim() : '';
      const password = passEl ? passEl.value : '';
      if(!username || !password){ showErr('กรุณากรอก ID และรหัสผ่านให้ครบค่ะ'); return; }
      if(typeof window.empVerifyPassword !== 'function'){ showErr('ระบบยังไม่พร้อม ลองรีเฟรชอีกครั้งค่ะ'); return; }
      const submitBtn = form.querySelector('[type="submit"]');
      if(submitBtn) submitBtn.disabled = true;
      try{
        const emp = await window.empVerifyPassword(username, password);
        if(!emp){ showErr('ID หรือรหัสผ่านไม่ถูกต้องค่ะ'); return; }
        window.currentRole = emp.roleKey;
        window.currentEmployee = emp;
        if(passEl) passEl.value = '';
        enterApp(((emp.name||'') + ' ' + (emp.surname||'')).trim() || emp.username);
      }finally{
        if(submitBtn) submitBtn.disabled = false;
      }
    });
  }

  if(devBtn){
    devBtn.addEventListener('click', ()=>{
      window.currentRole = 'developer';
      window.currentEmployee = { username:'dev', name:'Developer', roleKey:'developer' };
      if(passEl) passEl.value = '';
      enterApp('Developer (dev)');
    });
  }

  wireLogout(()=>{
    window.currentRole = null;
    window.currentEmployee = null;
    if(passEl) passEl.value = '';
    showLogin();
  });
}

// ---- FIREBASE: two stages ----------------------------------------------
// Stage 1 — DEVICE UNLOCK: a Firebase email/password account signs the browser
//   in so Firestore rules (request.auth != null) accept reads and writes. These
//   accounts exist ONLY for the owner/developer; staff never get one.
// Stage 2 — EMPLOYEE GATE: the normal in-app login. Employees are created in
//   Employee Management, verified against their salted hash, and their ROLE
//   comes from their employee record — exactly as in local mode.
// The Firebase session persists in the browser, so a shop terminal is unlocked
// once and staff simply sign in and out on top of it all day.
function authErrorMessage(code){

  switch(code){
    case 'auth/invalid-email':          return 'อีเมลไม่ถูกต้องค่ะ';
    case 'auth/user-disabled':          return 'บัญชีนี้ถูกระงับการใช้งาน';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':     return 'อีเมลหรือรหัสผ่านไม่ถูกต้องค่ะ';
    case 'auth/too-many-requests':      return 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่';
    case 'auth/network-request-failed': return 'เชื่อมต่อเครือข่ายไม่ได้ ลองใหม่ค่ะ';
    default:                            return 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่ค่ะ';
  }
}


let employeeGateWired = false;

function loginHint(text){
  let el = document.getElementById('loginStageHint');
  if(!el){
    const form = document.getElementById('loginForm');
    if(!form) return;
    el = document.createElement('p');
    el.id = 'loginStageHint';
    el.className = 'login-hint';
    form.insertBefore(el, form.firstChild);
  }
  el.textContent = text || '';
  el.style.display = text ? '' : 'none';
}

// Stage 1: unlock the browser against Firebase.
function stageDeviceUnlock(auth, signInWithEmailAndPassword){
  const form   = document.getElementById('loginForm');
  const userEl = document.getElementById('loginUsername');
  const passEl = document.getElementById('loginPassword');
  const errEl  = document.getElementById('loginError');
  const devBtn = document.getElementById('loginDevBtn');
  const showErr = (msg)=>{ if(errEl){ errEl.textContent = msg; errEl.style.display = 'block'; } };

  showLogin();
  loginHint('เข้าสู่ระบบด้วยบัญชี Firebase (สำหรับผู้ดูแล) เพื่อเชื่อมอุปกรณ์นี้กับฐานข้อมูล — ทำครั้งเดียวต่อเครื่อง');
  if(userEl){ userEl.type = 'email'; userEl.placeholder = 'email'; }
  if(devBtn) devBtn.style.display = 'none';       // no local dev bypass when the DB is live

  if(form && !form.__fbWired){
    form.__fbWired = true;
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      if(!window.__fbStage || window.__fbStage !== 'device') return;   // employee gate owns the form now
      if(errEl) errEl.style.display = 'none';
      const email = userEl ? userEl.value.trim() : '';
      const password = passEl ? passEl.value : '';
      if(!email || !password){ showErr('กรุณากรอก Email และ Password ให้ครบค่ะ'); return; }
      const btn = form.querySelector('[type="submit"]');
      if(btn) btn.disabled = true;
      try{
        await signInWithEmailAndPassword(auth, email, password);
        if(passEl) passEl.value = '';
      }catch(err){
        showErr(authErrorMessage(err && err.code));
      }finally{
        if(btn) btn.disabled = false;
      }
    });
  }
  window.__fbStage = 'device';
}

// Stage 2: the ordinary employee login, with a way back out of the device session.
function stageEmployeeGate(signOut, auth, user){
  const userEl = document.getElementById('loginUsername');
  const devBtn = document.getElementById('loginDevBtn');
  window.__fbStage = 'employee';
  if(userEl){ userEl.type = 'text'; userEl.placeholder = 'username'; }
  if(devBtn){
    devBtn.style.display = '';
    // In firebase mode the Dev role belongs to whoever unlocked the device.
    devBtn.textContent = user && user.email ? ('Developer \u00B7 ' + user.email) : 'Dev Login';
  }
  loginHint('อุปกรณ์นี้เชื่อมกับฐานข้อมูลแล้ว — เข้าสู่ระบบด้วย ID พนักงานของคุณ');

  if(!employeeGateWired){
    employeeGateWired = true;
    initLocalLogin();                       // same gate, same roles, same hashes

    // Leaving the device entirely (ends the Firebase session too).
    const form = document.getElementById('loginForm');
    if(form && !document.getElementById('loginSignOutDevice')){
      const link = document.createElement('button');
      link.type = 'button';
      link.id = 'loginSignOutDevice';
      link.className = 'btn btn-ghost';
      link.style.cssText = 'width:100%; margin-top:8px; font-size:12px; opacity:0.8;';
      link.textContent = 'ออกจากอุปกรณ์นี้ (Firebase)';
      link.addEventListener('click', async ()=>{
        try{ await signOut(auth); }catch(e){ console.error('signOut failed', e); }
        location.reload();
      });
      form.appendChild(link);
    }
  }else{
    showLogin();
  }
}

function fbFatal(msg){
  const errEl = document.getElementById('loginError');
  showLogin();
  loginHint('');
  if(errEl){ errEl.textContent = msg; errEl.style.display = 'block'; }
  const form = document.getElementById('loginForm');
  if(form) form.querySelectorAll('input,button').forEach(el=> el.disabled = true);
}

async function initFirebaseAuth(){
  // firebase-config.js boots asynchronously; without this the check below runs
  // first and every load looks like "Firebase unavailable".
  try{ if(window.__storeReady) await window.__storeReady; }catch(e){}
  const auth = window.firebaseAuth;

  if(!auth){
    // Deliberately NO fallback to the local gate: writes would go nowhere.
    console.error('[auth] Firebase auth unavailable');
    fbFatal('เชื่อมต่อ Firebase ไม่ได้ — รีเฟรชหน้าอีกครั้ง หรือตรวจอินเทอร์เน็ตก่อนใช้งาน');
    return;
  }

  const { signInWithEmailAndPassword, onAuthStateChanged, signOut } =
    await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");

  onAuthStateChanged(auth, async (user)=>{
    if(user){
      if(window.__hydrateStore) await window.__hydrateStore();   // rules need the session
      stageEmployeeGate(signOut, auth, user);
    }else{
      stageDeviceUnlock(auth, signInWithEmailAndPassword);
    }
  });
}

function initAuth(){
  if(window.APP_MODE !== 'firebase'){ initLocalLogin(); return; }
  initFirebaseAuth();
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initAuth);
}else{
  initAuth();
}
