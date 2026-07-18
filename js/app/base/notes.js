"use strict";
/* js/app/base/notes.js
   NOTES ("ความคิดสะเปะสะปะ")
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   NOTES ("ความคิดสะเปะสะปะ") — simple Topic + free-text notes.
   ============================================================ */
/* ============================================================
   NOTES — two contexts share one modal + list renderer:
     • 'room'   → notes that belong to the current room
     • 'global' → the top-level, room-less Note page
   ============================================================ */
let noteEditingId = null;
let noteEditingContext = 'room';   // which list the modal is editing

function loadGlobalNotes(){
  try{ return lsLoadCollection(GLOBAL_NOTES_KEY); }
  catch(e){ logAppError('โหลดโน้ตไม่สำเร็จ', e); return []; }
}
function saveGlobalNotes(){
  try{ lsSaveCollection(GLOBAL_NOTES_KEY, globalNotes); }
  catch(e){ logAppError('บันทึกโน้ตไม่สำเร็จ', e); alertSaveFailure(e); }
}
function noteUid(){ return 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }

// The note array + DOM targets for a given context.
function notesContextData(context){
  if(context === 'global'){
    return { list: globalNotes, wrapId: 'globalNotesListWrap', emptyId: 'globalNotesEmpty' };
  }
  const room = getCurrentRoom();
  return { list: room ? room.notes : [], wrapId: 'notesListWrap', emptyId: 'notesEmpty' };
}

function renderNotesList(context){
  context = context || 'room';
  const { list, wrapId, emptyId } = notesContextData(context);
  const wrap = document.getElementById(wrapId);
  const empty = document.getElementById(emptyId);
  if(!wrap) return;
  if(list.length === 0){
    wrap.innerHTML = '';
    if(empty) empty.style.display = 'block';
    return;
  }
  if(empty) empty.style.display = 'none';
  const sorted = [...list].sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||''));
  wrap.innerHTML = sorted.map(n=>`
    <div class="notes-list-item" data-id="${n.id}">
      <span class="notes-list-topic">${escapeHtml(n.topic)}</span>
      <span class="notes-list-arrow">›</span>
    </div>
  `).join('');
  wrap.querySelectorAll('.notes-list-item').forEach(el=>{
    el.addEventListener('click', ()=>{
      const note = list.find(n=>n.id===el.dataset.id);
      if(note) openNoteModal(note, context);
    });
  });
}

function openNoteModal(note, context){
  noteEditingId = note ? note.id : null;
  noteEditingContext = context || 'room';
  document.getElementById('noteModalTitle').textContent = note ? t('note.edit') : t('note.add');
  document.getElementById('noteId').value = note ? note.id : '';
  document.getElementById('noteTopic').value = note ? note.topic : '';
  document.getElementById('noteContent').value = note ? (note.content || '') : '';
  document.getElementById('noteBtnDelete').style.display = note ? 'inline-flex' : 'none';
  document.getElementById('noteModalOverlay').classList.add('show');
}
function closeNoteModal(){
  document.getElementById('noteModalOverlay').classList.remove('show');
}

function saveNoteModal(){
  const topic = document.getElementById('noteTopic').value.trim();
  const content = document.getElementById('noteContent').value;
  if(!topic){ alert(t('alert.needNoteTopic')); return; }

  const id = noteEditingId || noteUid();
  const noteData = { id, topic, content, updatedAt: new Date().toISOString() };

  if(noteEditingContext === 'global'){
    if(noteEditingId) globalNotes = globalNotes.map(n=> n.id === id ? noteData : n);
    else globalNotes.push(noteData);
    saveGlobalNotes();
  }else{
    const room = getCurrentRoom(); if(!room) return;
    if(noteEditingId) room.notes = room.notes.map(n=> n.id === id ? noteData : n);
    else room.notes.push(noteData);
    saveRooms();
  }
  closeNoteModal();
  renderNotesList(noteEditingContext);
}

function deleteNoteModal(){
  if(!noteEditingId) return;
  if(!confirm(t('confirm.deleteNote'))) return;
  if(noteEditingContext === 'global'){
    globalNotes = globalNotes.filter(n=> n.id !== noteEditingId);
    saveGlobalNotes();
  }else{
    const room = getCurrentRoom(); if(!room) return;
    room.notes = room.notes.filter(n=> n.id !== noteEditingId);
    saveRooms();
  }
  closeNoteModal();
  renderNotesList(noteEditingContext);
}

