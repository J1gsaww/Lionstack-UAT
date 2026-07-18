// ============================================================
// MOCK AUTH — local testing only.
//
// The real login screen (email + password) still lives in index.html,
// but it's a mock: no Firebase, no real credential check. By default
// the app skips the login screen entirely and drops straight into the
// bedroom, because we're testing locally.
//
// To bring the login screen back for a UI preview, flip REQUIRE_LOGIN
// to true — any non-empty email + password will "log in". When it's
// time to wire real Firebase Auth, replace this file with the Firebase
// version and this whole mock goes away.
// ============================================================
const REQUIRE_LOGIN = false;

function enterApp(email){
  const loginScreen = document.getElementById('loginScreen');
  const jigsawRoot = document.getElementById('jigsawRoot');
  if(loginScreen) loginScreen.style.display = 'none';
  if(jigsawRoot) jigsawRoot.style.display = 'block';
  document.body.classList.add('jigsaw-theme');

  const who = document.getElementById('jigsawLoggedInAs');
  if(who) who.textContent = email || 'local test user';
  window.currentUser = { email: email || 'local@test' };

  // Signal app.js that it's safe to load data and render.
  window.dispatchEvent(new Event('app-authenticated'));
  if(typeof window.onJigsawRootShown === 'function') window.onJigsawRootShown();
}

function showLogin(){
  const loginScreen = document.getElementById('loginScreen');
  const jigsawRoot = document.getElementById('jigsawRoot');
  if(loginScreen) loginScreen.style.display = 'flex';
  if(jigsawRoot) jigsawRoot.style.display = 'none';
  document.body.classList.remove('jigsaw-theme');
}

function initMockAuth(){
  const loginForm = document.getElementById('loginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');

  // Mock login handler (only matters when REQUIRE_LOGIN is true).
  if(loginForm){
    loginForm.addEventListener('submit', (e)=>{
      e.preventDefault();
      if(loginError) loginError.style.display = 'none';
      const email = loginEmail ? loginEmail.value.trim() : '';
      const password = loginPassword ? loginPassword.value : '';
      if(!email || !password){
        if(loginError){
          loginError.textContent = 'กรุณากรอก Email และ Password ให้ครบค่ะ';
          loginError.style.display = 'block';
        }
        return;
      }
      if(loginPassword) loginPassword.value = '';
      enterApp(email);
    });
  }

  // Logout: with mock auth there's nothing to sign out of, so just
  // return to the login screen (or straight back in if login is off).
  document.querySelectorAll('.logout-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(REQUIRE_LOGIN){ showLogin(); }
      else{ location.reload(); }
    });
  });

  if(REQUIRE_LOGIN){
    showLogin();
  }else{
    enterApp('local@test');
  }
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initMockAuth);
}else{
  initMockAuth();
}
