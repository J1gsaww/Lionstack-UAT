"use strict";
/* js/app/core/logo.js
   APP LOGO
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   APP LOGO — user-uploaded logo shown top-left (sidebar + login).
   Stored as a base64 data URL in localStorage. Any <img> tagged
   with class "app-logo-img" picks it up; data-default holds the
   fallback image used when no custom logo is set.
   ============================================================ */
const LOGO_STORAGE_KEY = 'app_logo_v1';
/* Sidebar logo rendering mode:
     'white'    → forced white silhouette (safe on the dark sidebar, drops brand colours)
     'original' → the uploaded image as-is
   Only affects the sidebar; the login card is light, so its logo is never filtered. */
const LOGO_STYLE_KEY = 'app_logo_style_v1';

function loadLogoStyle(){
  try{ return (Store.getRaw(LOGO_STYLE_KEY) === 'original') ? 'original' : 'white'; }
  catch(e){ return 'white'; }
}
function saveLogoStyle(style){
  try{ Store.setRaw(LOGO_STYLE_KEY, style); }catch(e){ /* ignore */ }
}

function loadLogo(){
  try{ return Store.getRaw(LOGO_STORAGE_KEY) || ''; }
  catch(e){ return ''; }
}
function saveLogo(dataUrl){
  try{
    Store.setRaw(LOGO_STORAGE_KEY, dataUrl);
    return true;
  }catch(e){
    // The size cap cannot promise the *total* fits: the rooms blob may already
    // be near the quota. Only the logo key fails here, so the task data is safe.
    logAppError('บันทึกโลโก้ไม่สำเร็จ', e);
    alert(t(isQuotaError(e) ? 'alert.logoFull' : 'alert.saveFail'));
    return false;
  }
}
function clearLogo(){
  try{ Store.removeRaw(LOGO_STORAGE_KEY); }
  catch(e){ /* ignore */ }
}
function applyLogo(){
  const logo = loadLogo();
  const white = (loadLogoStyle() === 'white');
  document.querySelectorAll('.app-logo-img').forEach(img=>{
    const def = img.dataset.default || '';
    const src = logo || def;
    if(src){
      img.src = src;
      img.style.display = '';
    }else{
      img.removeAttribute('src');
      img.style.display = 'none';
    }
    // Only the sidebar copy is filtered — the login card has a light background.
    const inSidebar = !!img.closest('.sidebar');
    img.classList.toggle('logo-white', inSidebar && white);
  });
}
function updateLogoStyleToggleUI(){
  const style = loadLogoStyle();
  document.querySelectorAll('.logo-style-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.logoStyle === style);
  });
}
function applyLogoStyle(style){
  saveLogoStyle(style === 'original' ? 'original' : 'white');
  applyLogo();
  updateLogoStyleToggleUI();
  renderSettingLogoPreview();
}
function renderSettingLogoPreview(){
  const logo = loadLogo();
  const img = document.getElementById('settingLogoPreview');
  const empty = document.getElementById('settingLogoEmpty');
  if(!img) return;
  // Mirror the sidebar: dark plate + white silhouette when that mode is on.
  const white = (loadLogoStyle() === 'white');
  const box = img.closest('.setting-logo-preview');
  if(box) box.classList.toggle('preview-dark', white);
  img.classList.toggle('logo-white', white);
  if(logo){
    img.src = logo;
    img.style.display = 'block';
    if(empty) empty.style.display = 'none';
  }else{
    img.removeAttribute('src');
    img.style.display = 'none';
    if(empty) empty.style.display = 'flex';
  }
}

