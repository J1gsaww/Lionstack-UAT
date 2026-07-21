"use strict";
/* js/app/core/main.js
   INIT — DOMContentLoaded boot sequence
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async ()=>{
  // Pre-login paint: the login screen shows BEFORE sign-in (and before the
  // Firestore cache hydrates), so paint theme + logo + language now from the
  // localStorage mirror. Re-applied below after hydrate in case Firestore has
  // newer values (e.g. changed on another device).
  try{
    currentLang = loadLang();
    applyStaticI18n();
    updateLangToggleUI();
    themeMode = loadThemeMode();
    customTheme().seeds = loadCustomSeeds();
    inkSettings = loadInkSettings();
    applyTheme(loadThemeId());
    applyLogo();
    updateLogoStyleToggleUI();
  }catch(e){ /* non-fatal — everything is re-applied after hydrate */ }

  // Wait for the data layer (Firestore cache) to hydrate before any Store read.
  if(window.__storeReady) await window.__storeReady;
  currentLang = loadLang();
  applyStaticI18n();
  updateLangToggleUI();
  applyLogo();
  updateLogoStyleToggleUI();
  await authReadyPromise;

  // Load rooms + global notes, build the BOARDS map, render the sidebar.
  rooms = loadRooms();
  if(strippedLegacyImages) saveRooms();   // old card images: reclaim the space now, not on the next edit
  rebuildBoards();
  globalNotes = loadGlobalNotes();
  customTheme().seeds = loadCustomSeeds();
  inkSettings = loadInkSettings();
  themeMode = loadThemeMode();
  applyTheme(loadThemeId());   // before the first paint, so nothing flashes
  appTimezone = loadTimezone();
  notifySettings = loadNotifySettings();
  homeSettings = loadHomeSettings();
  mountModulePages();       // build any module pages before the first navigate
  await initModules();      // let modules warm their own Store-backed state
  renderSidebar();
  navigateTo({ type:'home' });

  // --- error badge ---
  document.getElementById('errorBadge').addEventListener('click', (e)=>{
    if(e.target.id === 'errorBadgeClear') return;
    const panel = document.getElementById('errorBadgePanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('errorBadgeClear').addEventListener('click', (e)=>{
    e.stopPropagation();
    errorLog = [];
    renderErrorBadge();
  });

  // --- board view tabs (room Task page) ---
  document.querySelectorAll('.view-tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> switchView(btn.dataset.board, btn.dataset.view));
  });

  // --- list filters (current room → List view) ---
  document.querySelectorAll('.list-filter-status').forEach(sel=>{
    sel.addEventListener('change', (e)=>{
      const b = getCurrentRoom(); if(!b) return;
      b.listFilters.status = e.target.value; b.listPage = 1; renderCardList();
    });
  });
  document.querySelectorAll('.list-filter-from').forEach(inp=>{
    inp.addEventListener('change', (e)=>{
      const b = getCurrentRoom(); if(!b) return;
      b.listFilters.from = e.target.value; b.listPage = 1; renderCardList();
    });
  });
  document.querySelectorAll('.list-filter-to').forEach(inp=>{
    inp.addEventListener('change', (e)=>{
      const b = getCurrentRoom(); if(!b) return;
      b.listFilters.to = e.target.value; b.listPage = 1; renderCardList();
    });
  });
  document.querySelectorAll('.list-filter-clear').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const b = getCurrentRoom(); if(!b) return;
      b.listFilters = { status:'all', from:'', to:'' };
      b.listCategoryFilter = 'all';
      b.listPage = 1;
      renderCardList();
    });
  });

  // --- category filter (current room → List view). Options are rebuilt
  //     per room inside renderCardList; here we only wire the change. ---
  const catSel = document.getElementById('jigsaw-list-filter-category');
  if(catSel){
    catSel.addEventListener('change', (e)=>{
      const b = getCurrentRoom(); if(!b) return;
      b.listCategoryFilter = e.target.value; b.listPage = 1; renderCardList();
    });
  }

  // --- list sort (current room) ---
  const sortSel = document.getElementById('jigsaw-list-sort');
  if(sortSel){
    sortSel.addEventListener('change', (e)=>{
      const b = getCurrentRoom(); if(!b) return;
      b.listSort = e.target.value; b.listPage = 1; renderCardList();
    });
  }

  // --- completed filters ---
  const compSearch = document.getElementById('jigsaw-completed-search');
  if(compSearch){
    compSearch.addEventListener('input', (e)=>{ const b=getCurrentRoom(); if(!b)return; b.completedFilters.search=e.target.value; b.completedPage=1; renderCompletedList(); });
    document.getElementById('jigsaw-completed-from').addEventListener('change', (e)=>{ const b=getCurrentRoom(); if(!b)return; b.completedFilters.from=e.target.value; b.completedPage=1; renderCompletedList(); });
    document.getElementById('jigsaw-completed-to').addEventListener('change', (e)=>{ const b=getCurrentRoom(); if(!b)return; b.completedFilters.to=e.target.value; b.completedPage=1; renderCompletedList(); });
    document.getElementById('jigsaw-completed-clear').addEventListener('click', ()=>{ const b=getCurrentRoom(); if(!b)return; b.completedFilters={search:'',from:'',to:''}; b.completedPage=1; document.getElementById('jigsaw-completed-search').value=''; document.getElementById('jigsaw-completed-from').value=''; document.getElementById('jigsaw-completed-to').value=''; renderCompletedList(); });
  }

  // --- add-card button (current room) ---
  document.querySelectorAll('[data-action="add"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ const b=getCurrentRoom(); if(b) openCardModal(b, null); });
  });

  // --- kanban click (add-in-column / edit / delete) ---
  const kb = document.getElementById('jigsaw-kanban');
  if(kb){
    kb.addEventListener('click', (e)=>{
      const addBtn = e.target.closest('.kcol-add');
      if(addBtn){ const b = BOARDS[addBtn.dataset.board] || getCurrentRoom(); if(b) openCardModal(b, null, addBtn.dataset.status); return; }
      const delBtn = e.target.closest('.kcard-del');
      const cardEl = e.target.closest('.kcard');
      if(!cardEl) return;
      const b = BOARDS[cardEl.dataset.board] || getCurrentRoom(); if(!b) return;
      const card = b.cards.find(c=>c.id===cardEl.dataset.id);
      if(!card) return;
      if(delBtn) deleteCard(b, card.id); else openCardModal(b, card);
    });
  }

  // --- room calendar nav ---
  document.querySelectorAll('#page-calendar .cal-nav').forEach(btn=>{
    if(!btn.dataset.dir) return;
    btn.addEventListener('click', ()=>{
      const b = getCurrentRoom(); if(!b) return;
      const dir = parseInt(btn.dataset.dir,10);
      b.calDate = new Date(b.calDate.getFullYear(), b.calDate.getMonth() + dir, 1);
      renderCalendar(b);
    });
  });
  document.querySelectorAll('#page-calendar .cal-today').forEach(btn=>{
    btn.addEventListener('click', ()=>{ const b=getCurrentRoom(); if(!b)return; b.calDate=zoneTodayPointer(); renderCalendar(b); });
  });

  // --- main calendar nav ---
  document.querySelectorAll('#page-maincal .cal-nav').forEach(btn=>{
    if(!btn.dataset.dir) return;
    btn.addEventListener('click', ()=>{
      const dir = parseInt(btn.dataset.dir,10);
      mainCalDate = new Date(mainCalDate.getFullYear(), mainCalDate.getMonth() + dir, 1);
      renderMainCalendar();
    });
  });
  document.querySelectorAll('#page-maincal .cal-today').forEach(btn=>{
    btn.addEventListener('click', ()=>{ mainCalDate = zoneTodayPointer(); renderMainCalendar(); });
  });

  // --- card modal ---
  document.getElementById('cardModalClose').addEventListener('click', closeCardModal);
  document.getElementById('cardBtnCancel').addEventListener('click', closeCardModal);
  document.getElementById('cardBtnSave').addEventListener('click', (e)=> withButtonLoading(e.target, t('btn.saving'), saveCardModal));
  document.getElementById('cardModalOverlay').addEventListener('click', (e)=>{ if(e.target.id==='cardModalOverlay') closeCardModal(); });

  // --- card modal: calendar colour mode ---
  document.querySelectorAll('#cardTextColorField .text-mode-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> setCardTextMode(btn.dataset.textmode));
  });
  const cardTextColorEl = document.getElementById('cardTextColor');
  if(cardTextColorEl) cardTextColorEl.addEventListener('input', updateCardTextColorHint);
  const cardStatusEl = document.getElementById('cardStatus');
  if(cardStatusEl) cardStatusEl.addEventListener('change', updateCardTextColorHint);

  document.querySelectorAll('#cardColorField .color-mode-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> setCardColorMode(btn.dataset.colormode));
  });

  // Switching room rebuilds Status / Category / due-date rows for that room,
  // keeping whatever the user already typed into Topic / Details.
  const cardRoomSel = document.getElementById('cardRoom');
  if(cardRoomSel){
    cardRoomSel.addEventListener('change', (e)=>{
      const room = BOARDS[e.target.value]; if(!room) return;
      cardEditing = { boardKey: room.key, id: null };
      fillCardModalRoomFields(room, null, null, cardPresetDate);
    });
  }


  // --- note modal ---
  const btnAddNote = document.getElementById('btnAddNote');
  if(btnAddNote) btnAddNote.addEventListener('click', ()=> openNoteModal(null, 'room'));
  const btnAddGlobalNote = document.getElementById('btnAddGlobalNote');
  if(btnAddGlobalNote) btnAddGlobalNote.addEventListener('click', ()=> openNoteModal(null, 'global'));
  document.getElementById('noteModalClose').addEventListener('click', closeNoteModal);
  document.getElementById('noteBtnCancel').addEventListener('click', closeNoteModal);
  document.getElementById('noteBtnSave').addEventListener('click', (e)=> withButtonLoading(e.target, t('btn.saving'), saveNoteModal));
  document.getElementById('noteBtnDelete').addEventListener('click', deleteNoteModal);
  document.getElementById('noteModalOverlay').addEventListener('click', (e)=>{ if(e.target.id==='noteModalOverlay') closeNoteModal(); });

  // --- setting: logo upload ---
  document.getElementById('settingLogoInput').addEventListener('change', (e)=>{
    const input = e.target;
    const file = input.files && input.files[0];
    input.value = '';                    // let the same file be picked again
    if(!file) return;

    // accept="image/*" only filters the picker dialog; "All Files" walks past it.
    // Some browsers hand back an empty type, so fall back to the extension.
    const looksLikeImage = /^image\//.test(file.type || '')
      || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(file.name || '');
    if(!looksLikeImage){ alert(t('alert.logoNotImage')); return; }

    // Checked before reading: a 20 MB file should never reach memory at all.
    if(file.size > LOGO_MAX_BYTES){
      alert(t('alert.logoTooBig', { a: formatBytes(file.size), b: formatBytes(LOGO_MAX_BYTES) }));
      return;
    }

    const reader = new FileReader();
    reader.onerror = ()=>{ logAppError('อ่านไฟล์โลโก้ไม่สำเร็จ', null); alert(t('alert.logoRead')); };
    reader.onload = ()=>{
      if(!saveLogo(String(reader.result || ''))) return;   // nothing painted if nothing stored
      applyLogo();
      renderSettingLogoPreview();
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('settingLogoRemove').addEventListener('click', ()=>{
    if(!loadLogo()){ return; }
    if(!confirm(t('confirm.removeLogo'))) return;
    clearLogo();
    applyLogo();
    renderSettingLogoPreview();
  });

  // --- setting: top tabs (App Setting / Room Management) ---
  document.querySelectorAll('.setting-tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> showSettingTab(btn.dataset.settab));
  });
  // Store-only: hide the kanban-specific tabs (Room Management, Notification).
  if(STORE_ONLY){
    ['rooms','notify'].forEach(tab=>{
      const btn = document.querySelector(`.setting-tab-btn[data-settab="${tab}"]`);
      if(btn) btn.style.display = 'none';
    });
    if(settingTab === 'rooms' || settingTab === 'notify') settingTab = 'app';
  }

  // --- ink setting ---
  const inkCustom = document.getElementById('inkCustomColor');
  if(inkCustom) inkCustom.addEventListener('input', ()=>{
    inkSettings.color = inkCustom.value.toUpperCase();
    saveInkSettings();
    renderInkPreview();          // repaint swatches without rebuilding the picker
    refreshAllSurfaces();
  });

  // --- interface (import / export) ---
  const exportBtn = document.getElementById('exportBtn');
  if(exportBtn) exportBtn.addEventListener('click', doExport);
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  if(exportJsonBtn) exportJsonBtn.addEventListener('click', doExportJson);
  const importFile = document.getElementById('importFile');
  if(importFile) importFile.addEventListener('change', (e)=> handleImportFile(e.target.files && e.target.files[0]));
  const importApply = document.getElementById('importApply');
  if(importApply) importApply.addEventListener('click', doImportApply);

  // --- setting: time zone ---
  const tzSel = document.getElementById('settingTimezone');
  if(tzSel) tzSel.addEventListener('change', (e)=> applyTimezone(e.target.value));

  // --- setting: notification defaults (days and hours are independent) ---
  document.querySelectorAll('.notify-days-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> applyNotifySetting({ days: parseInt(btn.dataset.notifydays,10) }));
  });
  document.querySelectorAll('.notify-hours-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> applyNotifySetting({ hours: parseInt(btn.dataset.notifyhours,10) }));
  });

  // --- card modal: per-card notification rule ---
  document.querySelectorAll('.notify-mode-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{ cardNotifyMode = btn.dataset.notifymode; updateCardNotifyUI(); });
  });
  document.querySelectorAll('.card-notify-days-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{ cardNotifyDays = parseInt(btn.dataset.notifydays,10); updateCardNotifyUI(); });
  });
  document.querySelectorAll('.card-notify-hours-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{ cardNotifyHours = parseInt(btn.dataset.notifyhours,10); updateCardNotifyUI(); });
  });

  // Launch announcement: both rings speak once, right after the app is up.
  // STORE_ONLY: notifications are a Base App feature — stay silent in the store build.
  if(!STORE_ONLY) runNotificationScan({ announceDays:true });

  // While the app stays open, only the hour ring (and overdue) may speak again.
  window.setInterval(()=>{
    renderSidebar();
    if(currentView && currentView.type === 'notify') renderNotificationPage();
    if(!STORE_ONLY) runNotificationScan({ announceDays:false });
  }, 60000);

  // --- setting: rooms manager ---
  const btnAddRoom = document.getElementById('btnAddRoom');
  if(btnAddRoom) btnAddRoom.addEventListener('click', addRoom);

  // --- setting: logo render style (white silhouette vs original colours) ---
  document.querySelectorAll('.logo-style-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> applyLogoStyle(btn.dataset.logoStyle));
  });

  // --- setting: room picker + per-room status & category editors ---
  const settingRoomSelect = document.getElementById('settingRoomSelect');
  if(settingRoomSelect) settingRoomSelect.addEventListener('change', (e)=>{
    settingRoomId = e.target.value;
    renderStatusEditor();
    renderCategoryEditor();
  });
  const btnAddStatus = document.getElementById('btnAddStatus');
  if(btnAddStatus) btnAddStatus.addEventListener('click', addStatus);
  const btnAddCategory = document.getElementById('btnAddCategory');
  if(btnAddCategory) btnAddCategory.addEventListener('click', addCategory);

  // --- setting: language toggle ---
  document.querySelectorAll('.lang-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> applyLanguage(btn.dataset.lang));
  });
});

/* ============================================================================
 * Number fields: a lone "0" is a HINT, not content.
 *
 * Typing into a field pre-filled with 0 used to produce "0250". Every number
 * input that arrives holding just "0" is emptied and given "0" as its
 * placeholder instead, so the grey zero disappears the moment you type and the
 * save code (parseFloat(...)||0) still reads it as zero when left blank.
 *
 * Done globally here rather than in each render function so it covers the whole
 * app — including markup that is rebuilt on every redraw.
 * ==========================================================================*/
(function(){
  if(typeof document === 'undefined' || !document.addEventListener) return;

  function normalise(el){
    if(!el || el.tagName !== 'INPUT' || el.type !== 'number') return;
    if(!el.placeholder) el.placeholder = '0';
    if(el.value === '0') el.value = '';
  }
  function scan(node){
    if(!node || node.nodeType !== 1) return;
    try{
      if(node.matches && node.matches('input[type="number"]')) normalise(node);
      if(node.querySelectorAll) node.querySelectorAll('input[type="number"]').forEach(normalise);
    }catch(e){ /* detached or exotic node — ignore */ }
  }

  // Anything rendered later (modals, tables, forms) gets the same treatment.
  if(typeof MutationObserver === 'function' && document.documentElement){
    new MutationObserver(function(muts){
      muts.forEach(function(m){ (m.addedNodes || []).forEach(scan); });
    }).observe(document.documentElement, { childList:true, subtree:true });
  }

  // Catches zeros written programmatically after the element already existed.
  document.addEventListener('focusin', function(e){
    var el = e.target;
    if(el && el.tagName === 'INPUT' && el.type === 'number' && el.value === '0'){
      if(!el.placeholder) el.placeholder = '0';
      el.value = '';
    }
  });

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ scan(document.body); });
  else scan(document.body);
})();

/* ============================================================================
 * Esc closes the top-most popup.
 *
 * Every modal in the app is an .art-modal-overlay appended to <body>, and each
 * one's own close() just removes that element — so dismissing the last one here
 * behaves exactly like clicking Cancel, without every modal wiring its own key
 * handler.
 * ==========================================================================*/
(function(){
  if(typeof window === 'undefined' || !window.addEventListener) return;

  // Known in-page "back" buttons (order form, product form, edit history,
  // payroll detail) plus a generic [data-back] hook for anything added later.
  const BACK_SELECTOR = '#oBack, #pBack, #ehBack, #ehBack2, #payBack, [data-back]';
  const isVisible = (el)=> !!(el && (el.offsetParent !== null || el.getClientRects().length));

  function onEsc(e){
    // Some browsers still report the legacy names, so check all of them.
    const isEsc = e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27 || e.which === 27;
    if(!isEsc) return;

    // A popup always wins — close the top-most one first.
    const all = document.querySelectorAll('.art-modal-overlay');
    if(all.length){
      const top = all[all.length - 1];
      if(top && top.parentNode){
        e.preventDefault();
        top.remove();
      }
      return;
    }

    // Otherwise leave the current in-page form exactly as its Back button would.
    let back = null;
    const list = document.querySelectorAll(BACK_SELECTOR);
    for(let i = 0; i < list.length; i++){ if(isVisible(list[i])){ back = list[i]; break; } }
    if(back){
      e.preventDefault();
      back.click();
    }
  }

  // CAPTURE phase on window: this runs before any handler further down the tree,
  // so nothing can swallow the key first (native pickers aside).
  window.addEventListener('keydown', onEsc, true);
  window.__escHandlerReady = true;   // type __escHandlerReady in the console to confirm it loaded
})();
