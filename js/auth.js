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

// ---- FIREBASE: real email/password (dynamic import; Developer role) ----
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

async function initFirebaseAuth(){
  const auth = window.firebaseAuth;
  const loginForm = document.getElementById('loginForm');
  const userEl = document.getElementById('loginUsername');
  const passEl = document.getElementById('loginPassword');
  const errEl = document.getElementById('loginError');
  const showErr = (msg)=>{ if(errEl){ errEl.textContent = msg; errEl.style.display = 'block'; } };

  if(!auth){
    console.warn('[auth] Firebase unavailable — falling back to local login');
    if(window.__hydrateStore) await window.__hydrateStore();
    initLocalLogin();
    return;
  }

  const { signInWithEmailAndPassword, onAuthStateChanged, signOut } =
    await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");

  onAuthStateChanged(auth, async (user)=>{
    if(user){
      if(window.__hydrateStore) await window.__hydrateStore();
      window.currentRole = 'developer';   // a real Firebase sign-in = Developer
      window.currentEmployee = { username: user.email || 'dev', roleKey: 'developer' };
      enterApp(user.email || 'Developer');
    }else{
      showLogin();
    }
  });

  if(loginForm){
    loginForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      if(errEl) errEl.style.display = 'none';
      const email = userEl ? userEl.value.trim() : '';
      const password = passEl ? passEl.value : '';
      if(!email || !password){ showErr('กรุณากรอก Email และ Password ให้ครบค่ะ'); return; }
      const submitBtn = loginForm.querySelector('[type="submit"]');
      if(submitBtn) submitBtn.disabled = true;
      try{
        await signInWithEmailAndPassword(auth, email, password);
        if(passEl) passEl.value = '';
      }catch(err){
        showErr(authErrorMessage(err && err.code));
      }finally{
        if(submitBtn) submitBtn.disabled = false;
      }
    });
  }

  wireLogout(async ()=>{ try{ await signOut(auth); }catch(e){ console.error('signOut failed', e); } });
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
