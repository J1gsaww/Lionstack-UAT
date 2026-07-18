"use strict";
/* js/app/base/rooms.js
   BOARD / ROOMS / ROOMS MANAGER / STATUS & CATEGORY
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   BOARD — the personal task board ("ไดอารี่ส่วนตัว").
   Kept as a single-board version of the original multi-board
   engine, so calendar/list/kanban logic is unchanged.
   ============================================================ */
/* ============================================================
   ROOMS — the app is organised into 1–5 rooms. Each room owns its
   own Task cards, Notes, Status config and Category config. The
   Main Calendar (outside rooms) aggregates Task cards from every
   room; the global Note page is a single room-less notepad.

   BOARDS is a runtime map keyed by roomId, so the existing board
   engine (which looks up BOARDS[boardKey]) keeps working — a
   "board" is now simply the currently-selected room.
   ============================================================ */
const ROOMS_STORAGE_KEY = 'app_rooms_v1';
const GLOBAL_NOTES_KEY  = 'app_global_notes_v1';
const MAX_ROOMS = 5;

const DEFAULT_STATUSES = [
  { name:"To Do",       color:"#FDBD31", isComplete:false },
  { name:"In Progress", color:"#FB7562", isComplete:false },
  { name:"Done",        color:"#6B8F71", isComplete:true  },
  { name:"On Hold",     color:"#B0A28C", isComplete:false },
  { name:"Cancelled",   color:"#8A7A6E", isComplete:false }
];
const DEFAULT_CATEGORIES = [
  { name:"Solo Traveling",   color:"#4A90A4" },
  { name:"Friend",           color:"#FDBD31" },
  { name:"Family",           color:"#FB7562" },
  { name:"Couple",           color:"#D46A9F" },
  { name:"Hobby",            color:"#6B8F71" },
  { name:"Business Meeting", color:"#272727" },
  { name:"Important Task",   color:"#C6432E" },
  { name:"Shopping",         color:"#8A7A6E" }
];

const BOARDS = {};        // roomId -> room object (runtime "board")
let rooms = [];           // ordered, persisted list of rooms
let currentRoomId = null; // room currently shown in the room pages
let globalNotes = [];     // room-less notes (top-level Note page)

function roomUid(){ return 'room_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }

// A fresh room: default status + category config, no data yet.
function makeRoom(name, nameTh){
  return {
    id: roomUid(),
    name: name || 'Example',
    nameTh: nameTh || '',          // optional Thai label; '' means "fall back to name"
    statusConfig: DEFAULT_STATUSES.map(s=>({...s})),
    categoryConfig: DEFAULT_CATEGORIES.map(c=>({...c})),
    cards: [],
    notes: []
  };
}

// The label to SHOW for a room. Thai UI prefers nameTh when set; everything
// else (and English UI) uses name. This is display only — matching, dedup, and
// storage all key off room.id and room.name, never this.
function roomLabel(room){
  if(!room) return '';
  if(currentLang === 'th' && room.nameTh) return room.nameTh;
  return room.name || '';
}

// Persist only the durable fields; derived + runtime state is rebuilt on load.
function roomToStored(r){
  return { id:r.id, name:r.name, nameTh:r.nameTh || '', statusConfig:r.statusConfig, categoryConfig:r.categoryConfig, cards:r.cards, notes:r.notes };
}
function saveRooms(){
  try{ Store.setRaw(ROOMS_STORAGE_KEY, JSON.stringify(rooms.map(roomToStored))); }
  catch(e){ logAppError('บันทึกห้องไม่สำเร็จ', e); alertSaveFailure(e); }
}
function normalizeStoredRoom(r){
  const room = {
    id: r.id || roomUid(),
    name: r.name || 'Room',
    nameTh: (typeof r.nameTh === 'string') ? r.nameTh : '',   // old rooms: no Thai label
    statusConfig: (Array.isArray(r.statusConfig) && r.statusConfig.length) ? r.statusConfig.map(s=>({...s})) : DEFAULT_STATUSES.map(s=>({...s})),
    categoryConfig: (Array.isArray(r.categoryConfig) && r.categoryConfig.length) ? r.categoryConfig.map(c=>({...c})) : DEFAULT_CATEGORIES.map(c=>({...c})),
    cards: Array.isArray(r.cards) ? r.cards : [],
    notes: Array.isArray(r.notes) ? r.notes : []
  };
  if(!room.statusConfig.some(s=>s.isComplete)) room.statusConfig[room.statusConfig.length-1].isComplete = true;
  return room;
}
// Cards used to carry a base64 `image`. The feature is gone; drop whatever is
// left in storage so the blob shrinks on the next save instead of sitting there.
let strippedLegacyImages = false;
function stripLegacyImages(list){
  list.forEach(r=> (r.cards || []).forEach(c=>{
    if('image' in c){ delete c.image; strippedLegacyImages = true; }
  }));
  return list;
}
function loadRooms(){
  try{
    const raw = Store.getRaw(ROOMS_STORAGE_KEY);
    if(!raw) return [ makeRoom('Example') ];
    const parsed = JSON.parse(raw);
    if(!Array.isArray(parsed) || parsed.length === 0) return [ makeRoom('Example') ];
    return stripLegacyImages(parsed.map(normalizeStoredRoom));
  }catch(e){
    logAppError('โหลดห้องไม่สำเร็จ', e);
    return [ makeRoom('Example') ];
  }
}

// Derive board-engine fields (statuses / colors / completeStatus /
// categoryOptions / categoryColors) from the room's config, and make
// sure per-room runtime state (calendar month, filters, paging) exists.
function applyRoomDerived(room){
  room.key = room.id;
  room.statuses = room.statusConfig.map(s=>s.name);
  room.colors = {};
  room.statusConfig.forEach(s=>{ room.colors[s.name] = s.color; });
  const complete = room.statusConfig.find(s=>s.isComplete) || room.statusConfig[room.statusConfig.length-1];
  room.completeStatus = complete.name;
  room.terminal = [complete.name];        // only the completed status is exempt from overdue
  room.excludeDueDateStatuses = [];        // every status can carry a due date
  room.categoryOptions = room.categoryConfig.map(c=>c.name);
  room.categoryColors = {};
  room.categoryConfig.forEach(c=>{ room.categoryColors[c.name] = c.color; });
  if(!room.calDate)              room.calDate = zoneTodayPointer();
  if(!room.listFilters)          room.listFilters = { status:'all', from:'', to:'' };
  if(room.listPage == null)      room.listPage = 1;
  if(!room.completedFilters)     room.completedFilters = { search:'', from:'', to:'' };
  if(room.completedPage == null) room.completedPage = 1;
  if(room.listCategoryFilter == null) room.listCategoryFilter = 'all';
  if(room.listSort == null) room.listSort = 'due';   // 'due' | 'status' | 'category' | 'due:<statusName>'
  // A saved sort can point at a status that was later renamed or deleted.
  if(String(room.listSort).startsWith('due:') && !room.statuses.includes(room.listSort.slice(4))) room.listSort = 'due';
  return room;
}

// Rebuild the BOARDS map from `rooms` and keep currentRoomId valid.
function rebuildBoards(){
  Object.keys(BOARDS).forEach(k=> delete BOARDS[k]);
  rooms.forEach(r=>{ applyRoomDerived(r); BOARDS[r.id] = r; });
  if(!currentRoomId || !BOARDS[currentRoomId]) currentRoomId = rooms.length ? rooms[0].id : null;
}
function getCurrentRoom(){ return BOARDS[currentRoomId] || null; }

/* ============================================================
   ROOMS MANAGER — Setting page. Add / rename / delete / reorder
   rooms, capped at MAX_ROOMS. At least one room must always
   remain, and deleting a room destroys its Task cards + Notes.
   ============================================================ */
function addRoom(){
  if(rooms.length >= MAX_ROOMS){ alert(t('alert.maxRooms',{n:MAX_ROOMS})); return; }
  rooms.push(makeRoom(uniqueName(rooms, t('room.newName'))));
  saveRooms();
  rebuildBoards();
  renderRoomsEditor();
  refreshSettingEditors();
  renderSidebar();
}

function renameRoom(index, rawEn, rawTh){
  const r = rooms[index]; if(!r) return;
  const newName = String(rawEn == null ? r.name : rawEn).trim();
  const newTh = String(rawTh == null ? (r.nameTh||'') : rawTh).trim();
  // English is the required field; empty English reverts the whole row.
  if(!newName){ alert(t('alert.roomNameEnRequired')); renderRoomsEditor(); return; }
  // Dedup on the English name only (the durable identity); Thai may repeat.
  if(rooms.some((x,i)=> i!==index && x.name === newName)){
    alert(t('alert.dupRoom'));
    renderRoomsEditor();
    return;
  }
  if(newName === r.name && newTh === (r.nameTh||'')) return;   // nothing changed
  r.name = newName;
  r.nameTh = newTh;
  saveRooms();
  renderRoomsEditor();
  renderSettingRoomPicker();
  renderSidebar();
}

function deleteRoom(index){
  const r = rooms[index]; if(!r) return;
  if(rooms.length <= 1){ alert(t('alert.cantDeleteLastRoom')); return; }
  if(!confirm(t('confirm.deleteRoom',{ name:roomLabel(r), cards:r.cards.length, notes:r.notes.length }))) return;

  const snap = snapshotData();                        // taken before anything moves
  const wasCurrent = (currentRoomId === r.id);
  if(settingRoomId === r.id) settingRoomId = null;   // getSettingRoom() re-picks
  // Drop the deleted room's Home preferences so they don't linger in storage.
  if(homeSettings.featured === r.id) homeSettings.featured = null;
  if(homeSettings.modes && homeSettings.modes[r.id]) delete homeSettings.modes[r.id];
  saveHomeSettings();
  const viewingDeleted = !!(currentView && currentView.type === 'room' && currentView.roomId === r.id);
  rooms.splice(index, 1);
  if(wasCurrent) currentRoomId = null;                   // rebuildBoards() re-picks the first room
  saveRooms();
  rebuildBoards();
  // If the deleted room's page was on screen, actually leave it — otherwise the
  // DOM keeps showing a page whose room no longer exists.
  if(viewingDeleted){
    navigateTo({ type:'setting' });
    offerUndo(t('undo.room', { name: roomLabel(r) }), snap);
    return;
  }
  renderRoomsEditor();
  refreshSettingEditors();
  renderSidebar();
  offerUndo(t('undo.room', { name: roomLabel(r) }), snap);
}

let roomDragFromIndex = null;
function reorderRoom(from, to){
  if(from === null || to === null || from === to) return;
  if(from < 0 || to < 0 || from >= rooms.length || to >= rooms.length) return;
  const [moved] = rooms.splice(from, 1);
  rooms.splice(to, 0, moved);
  saveRooms();
  rebuildBoards();
  renderRoomsEditor();
  renderSettingRoomPicker();
  renderSidebar();
}

function renderRoomsEditor(){
  renderExportRooms();   // the export picker lists rooms too
  const list = document.getElementById('roomsEditorList');
  if(!list) return;
  const canDelete = rooms.length > 1;

  // Written from JS (not data-i18n) because the copy interpolates MAX_ROOMS.
  const desc = document.getElementById('settingRoomsDesc');
  if(desc) desc.textContent = t('setting.rooms.desc',{n:MAX_ROOMS});

  list.innerHTML = rooms.map((r,i)=>`
    <div class="room-editor-row" data-index="${i}" draggable="false">
      <span class="status-drag-handle" title="${t('status.dragHandle')}">⠿</span>
      <div class="room-editor-main">
        <div class="room-name-fields">
          <input type="text" class="room-name-input" data-lang="en" value="${escapeHtml(r.name)}" maxlength="40" placeholder="${escapeHtml(t('room.nameEn'))}">
          <input type="text" class="room-name-input" data-lang="th" value="${escapeHtml(r.nameTh || '')}" maxlength="40" placeholder="${escapeHtml(t('room.nameTh'))}">
        </div>
        <div class="room-editor-meta">${t('room.count',{c:r.cards.length, n:r.notes.length})}</div>
      </div>
      ${canDelete
        ? '<button class="btn-icon room-del-btn" title="'+escapeHtml(t('room.delete'))+'">🗑️</button>'
        : '<span class="status-locked" title="'+escapeHtml(t('alert.cantDeleteLastRoom'))+'">🔒</span>'}
    </div>
  `).join('');

  list.querySelectorAll('.room-name-input').forEach(inp=>{
    inp.addEventListener('change', (e)=>{
      const row = e.target.closest('.room-editor-row');
      const i = parseInt(row.dataset.index, 10);
      const en = row.querySelector('.room-name-input[data-lang="en"]').value;
      const th = row.querySelector('.room-name-input[data-lang="th"]').value;
      renameRoom(i, en, th);
    });
  });
  list.querySelectorAll('.room-del-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const i = parseInt(e.target.closest('.room-editor-row').dataset.index, 10);
      deleteRoom(i);
    });
  });

  // Drag-to-reorder: the row only becomes draggable while grabbing the handle,
  // so the name input stays clickable.
  list.querySelectorAll('.room-editor-row').forEach(row=>{
    const handle = row.querySelector('.status-drag-handle');
    handle.addEventListener('mousedown', ()=>{ row.draggable = true; });
    handle.addEventListener('touchstart', ()=>{ row.draggable = true; }, { passive:true });

    row.addEventListener('dragstart', (e)=>{
      roomDragFromIndex = parseInt(row.dataset.index, 10);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(roomDragFromIndex));
    });
    row.addEventListener('dragend', ()=>{
      row.draggable = false;
      row.classList.remove('dragging');
      list.querySelectorAll('.room-editor-row').forEach(x=> x.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e)=>{
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', ()=> row.classList.remove('drag-over'));
    row.addEventListener('drop', (e)=>{
      e.preventDefault();
      row.classList.remove('drag-over');
      const to = parseInt(row.dataset.index, 10);
      reorderRoom(roomDragFromIndex, to);
      roomDragFromIndex = null;
    });
  });

  // Add button reflects the cap.
  const addBtn = document.getElementById('btnAddRoom');
  if(addBtn){
    const full = rooms.length >= MAX_ROOMS;
    addBtn.disabled = full;
    addBtn.textContent = full ? t('setting.rooms.full',{n:MAX_ROOMS}) : t('setting.rooms.add');
  }
}

/* ============================================================
   STATUS & CATEGORY CONFIG — per-room, edited from the Setting page.

   The Setting page has its own room picker (settingRoomId), which is
   independent of the room currently open in the room pages
   (currentRoomId). Board DOM is only re-rendered when the edited room
   happens to be the one on screen.

   Status: exactly one entry is flagged isComplete. It can be renamed
   and recoloured but never deleted, and it stays the "completed"
   status that syncs with the Completed view.
   Category: same shape minus isComplete. At least one must remain,
   because every card carries a category.
   ============================================================ */
let settingRoomId = null;

function getSettingRoom(){
  if(settingRoomId && BOARDS[settingRoomId]) return BOARDS[settingRoomId];
  settingRoomId = currentRoomId || (rooms[0] && rooms[0].id) || null;
  return BOARDS[settingRoomId] || null;
}
// Editing a room that isn't on screen shouldn't repaint the room pages.
function refreshIfVisible(room){
  if(room && room.id === currentRoomId) refreshBoard(room);
}
function refreshSettingEditors(){
  renderSettingRoomPicker();
  renderStatusEditor();
  renderCategoryEditor();
}

function getCompleteIndex(room){
  const i = room.statusConfig.findIndex(s=>s.isComplete);
  return i >= 0 ? i : room.statusConfig.length - 1;
}
function uniqueName(list, base){
  const names = list.map(x=>x.name);
  if(!names.includes(base)) return base;
  let i = 2;
  while(names.includes(base + ' ' + i)) i++;
  return base + ' ' + i;
}

