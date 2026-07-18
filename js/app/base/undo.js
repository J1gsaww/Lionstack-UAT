"use strict";
/* js/app/base/undo.js
   UNDO
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   UNDO

   Only destructive, hard-to-retype operations get an undo: deleting a room,
   and an import that removes or overwrites cards. One level, held for as long
   as the toast is on screen — a snackbar, not a history. Keeping a deeper
   stack would promise a Ctrl+Z the app has nowhere to put.

   The snapshot is the whole data layer rather than a diff: diffs of a diff are
   where undo bugs live, and the payload is text-only now, so it is cheap.
   ============================================================ */
const UNDO_WINDOW_MS = 20000;
let pendingUndo = null;   // { snap, el, tick, timer }

function snapshotData(){
  // Settings ride along even for a room delete, where they never change: an
  // undo that restores the cards but leaves an imported theme behind is a
  // half-undo, and the caller should not have to remember which kind it made.
  return JSON.parse(JSON.stringify({
    rooms: rooms.map(roomToStored),
    globalNotes,
    homeSettings,
    currentRoomId,
    settings: {
      lang: currentLang,
      timezone: loadTimezone(),
      theme: currentThemeId,
      themeMode,
      customSeeds: customTheme().seeds,
      ink: inkSettings,
      notify: notifySettings,
      logoStyle: loadLogoStyle(),
      logo: loadLogo() || ''
    }
  }));
}

function restoreData(snap){
  rooms = snap.rooms.map(normalizeStoredRoom);
  globalNotes = JSON.parse(JSON.stringify(snap.globalNotes));
  homeSettings = JSON.parse(JSON.stringify(snap.homeSettings));
  currentRoomId = snap.currentRoomId;
  settingRoomId = null;              // getSettingRoom() re-picks a live room
  saveRooms(); saveGlobalNotes(); saveHomeSettings();
  rebuildBoards();               // before any repaint: rooms have no derived fields yet
  restoreSettings(snap.settings);

  // An undone import may have removed the room we are standing in.
  if(currentView && currentView.type === 'room' && !BOARDS[currentView.roomId]){
    navigateTo({ type:'home' });
  }else{
    refreshAllSurfaces();
    if(document.getElementById('page-setting').style.display !== 'none'){
      renderRoomsEditor();
      refreshSettingEditors();
    }
    renderExportRooms();
  }
}

function restoreSettings(st){
  if(!st) return;
  notifySettings = st.notify; saveNotifySettings();
  inkSettings    = st.ink;    saveInkSettings();
  saveTimezone(st.timezone);
  customTheme().seeds = st.customSeeds; saveCustomSeeds();
  themeMode = st.themeMode;   saveThemeMode();
  saveLogoStyle(st.logoStyle === 'original' ? 'original' : 'white');
  if(st.logo) saveLogo(st.logo); else clearLogo();
  applyTheme(st.theme);
  applyLogo();
  if(currentLang !== st.lang) applyLanguage(st.lang);
}

function clearPendingUndo(){
  if(!pendingUndo) return;
  window.clearInterval(pendingUndo.tick);
  window.clearTimeout(pendingUndo.timer);
  if(pendingUndo.el) pendingUndo.el.remove();
  pendingUndo = null;
}

// A second destructive action replaces the first offer: two overlapping undos
// would restore the older snapshot and silently discard the newer change.
function offerUndo(message, snap){
  clearPendingUndo();
  const stack = document.getElementById('toastStack');
  if(!stack) return;

  const el = document.createElement('div');
  el.className = 'toast toast-undo';
  el.innerHTML = `
    <div class="toast-head">
      <span class="toast-title">${escapeHtml(message)}</span>
      <button class="toast-close" title="${escapeHtml(t('toast.close'))}">&times;</button>
    </div>
    <div class="toast-undo-row">
      <button type="button" class="btn btn-ghost undo-btn">${escapeHtml(t('undo.btn'))}</button>
      <span class="undo-left"></span>
    </div>`;
  stack.appendChild(el);

  let left = Math.round(UNDO_WINDOW_MS / 1000);
  const leftEl = el.querySelector('.undo-left');
  const paint = ()=> leftEl.textContent = t('undo.left', { n: left });
  paint();

  const tick = window.setInterval(()=>{ left -= 1; if(left >= 0) paint(); }, 1000);
  const timer = window.setTimeout(clearPendingUndo, UNDO_WINDOW_MS);
  pendingUndo = { snap, el, tick, timer };

  el.querySelector('.undo-btn').addEventListener('click', ()=>{
    const s = pendingUndo && pendingUndo.snap;
    clearPendingUndo();
    if(s) restoreData(s);
  });
  el.querySelector('.toast-close').addEventListener('click', clearPendingUndo);
}

function showToast(kind, title, items){
  const stack = document.getElementById('toastStack');
  if(!stack) return null;

  const lines = items.slice(0, TOAST_MAX_LINES);
  const more = items.length - lines.length;

  const el = document.createElement('div');
  el.className = 'toast toast-' + kind + ' locked';
  el.innerHTML = `
    <div class="toast-head">
      <span class="toast-title">${escapeHtml(title)}</span>
      <button class="toast-close" disabled title="${escapeHtml(t('toast.lockedHint'))}">&times;</button>
    </div>
    <div class="toast-body">
      ${lines.map(it=>`<div class="toast-line">
          ${it.roomName ? `<span class="toast-line-room">${escapeHtml(it.roomName)}</span>` : ''}
          <span class="toast-line-topic">${escapeHtml(it.title)}</span>
        </div>`).join('')}
      ${more > 0 ? '<div class="toast-more">'+escapeHtml(t('toast.more',{n:more}))+'</div>' : ''}
    </div>`;
  stack.appendChild(el);

  const closeBtn = el.querySelector('.toast-close');
  window.setTimeout(()=>{
    el.classList.remove('locked');
    closeBtn.disabled = false;
    closeBtn.title = t('toast.close');
  }, TOAST_LOCK_MS);

  closeBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    if(closeBtn.disabled) return;   // still inside the 5s lock
    el.remove();
  });
  el.addEventListener('click', ()=>{ navigateTo({ type:'notify' }); });
  return el;
}

/* Announcements are remembered per session so the 60s tick doesn't re-toast
   the same task. A task that leaves a ring is forgotten, so it can announce
   again if it comes back. */
const announced = { overdue: new Set(), hour: new Set() };

function runNotificationScan(opts){
  opts = opts || {};
  const items = collectNotifications();
  const byBucket = { overdue:[], hour:[], day:[] };
  items.forEach(it=> byBucket[it.bucket].push(it));

  // Forget anything that's no longer in that ring (date pushed back, completed, deleted).
  const idsIn = b => new Set(byBucket[b].map(it=> it.id));
  ['overdue','hour'].forEach(b=>{
    const live = idsIn(b);
    [...announced[b]].forEach(id=>{ if(!live.has(id)) announced[b].delete(id); });
  });

  const fresh = b => byBucket[b].filter(it=> !announced[b].has(it.id));

  const overdue = fresh('overdue');
  if(overdue.length){
    showToast('overdue', t('toast.overdue',{n:overdue.length}), overdue);
    overdue.forEach(it=> announced.overdue.add(it.id));
  }

  const hour = fresh('hour');
  if(hour.length){
    showToast('hour', t('toast.hour',{n:hour.length}), hour);
    hour.forEach(it=> announced.hour.add(it.id));
  }

  // The day ring only speaks at launch — otherwise it would nag all session.
  if(opts.announceDays && byBucket.day.length){
    showToast('day', t('toast.day',{n:byBucket.day.length}), byBucket.day);
  }
}

function formatDeadline(d){
  const p = zoneParts(d, appTimezone);
  return `${String(p.day).padStart(2,'0')} ${monthName(p.month)} ${p.year} · ${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`;
}

function renderNotificationPage(){
  const wrap = document.getElementById('notifyListWrap');
  const empty = document.getElementById('notifyEmpty');
  if(!wrap) return;
  const items = collectNotifications();

  const hint = document.getElementById('notifyPageHint');
  if(hint) hint.textContent = t('notify.page.hint', { t: ruleLabel(notifySettings) });

  if(items.length === 0){
    wrap.innerHTML = '';
    if(empty) empty.style.display = 'block';
    return;
  }
  if(empty) empty.style.display = 'none';

  wrap.innerHTML = items.map((it,i)=>{
    const late = it.msLeft < 0;
    const when = Math.abs(it.msLeft) < 60000
      ? t('notify.now')
      : (late ? t('notify.late', { t: humanizeDuration(it.msLeft) })
              : t('notify.left', { t: humanizeDuration(it.msLeft) }));
    return `<div class="notify-item ${late?'late':''}" data-index="${i}">
      <div class="notify-item-main">
        <div class="notify-item-top">
          ${it.roomName ? `<span class="notify-room">${escapeHtml(it.roomName)}</span>` : ''}
          <span class="pill" style="background:${it.color}; color:${it.ink}">${escapeHtml(it.tag)}</span>
          ${it.extraTag ? '<span class="notify-custom-tag">'+escapeHtml(it.extraTag)+'</span>' : ''}
        </div>
        <div class="notify-topic">${escapeHtml(it.title)}</div>
        <div class="notify-deadline">${escapeHtml(it.subtitle)}</div>
      </div>
      <div class="notify-when ${late?'late':''}">${escapeHtml(when)}</div>
    </div>`;
  }).join('');

  wrap.querySelectorAll('.notify-item').forEach(el=>{
    el.addEventListener('click', ()=>{
      const it = items[parseInt(el.dataset.index, 10)];
      if(it && typeof it.onClick === 'function') it.onClick();
    });
  });
}

