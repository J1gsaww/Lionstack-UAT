"use strict";
/* js/app/base/card-modal.js
   CARD MODAL
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   CARD MODAL
   ============================================================ */
function renderCardDueDatesList(board, card, presetDate){
  const container = document.getElementById('cardDueDatesList');
  const eligible = getDueDateEligibleStatuses(board);
  container.innerHTML = eligible.map(status=>{
    const color = board.colors[status] || fallbackColor();
    const isComplete = status === board.completeStatus;
    // New cards created by clicking a calendar day get that day as their
    // (mandatory) completed-status due date.
    let value = '';
    if(card && card.dueDates) value = card.dueDates[status] || '';
    else if(!card && isComplete && presetDate) value = presetDate;
    const timeValue = (card && card.dueTimes) ? (card.dueTimes[status] || '') : '';
    return `<div class="card-duedate-row" data-status="${escapeHtml(status)}">
      <div class="cdr-label">
        <span class="cdr-dot" style="background:${color}"></span>
        ${escapeHtml(status)} ${isComplete ? '<span class="cdr-required">'+t('card.required')+'</span>' : ''}
      </div>
      <input type="date" class="cdr-input" data-status="${escapeHtml(status)}" value="${value}">
      <input type="time" class="cdr-time" data-status="${escapeHtml(status)}" value="${timeValue}" title="${escapeHtml(t('card.timeTitle'))}">
    </div>`;
  }).join('');
}

let cardPresetDate = null;   // remembered so switching room re-applies it
let cardColorMode = 'category';
let cardTextMode = 'default';
let cardNotifyMode = 'default';
let cardNotifyDays = 1;
let cardNotifyHours = 5;

function updateCardNotifyUI(){
  document.querySelectorAll('.notify-mode-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.notifymode === cardNotifyMode);
  });
  document.querySelectorAll('.card-notify-days-btn').forEach(b=>{
    b.classList.toggle('active', parseInt(b.dataset.notifydays,10) === cardNotifyDays);
  });
  document.querySelectorAll('.card-notify-hours-btn').forEach(b=>{
    b.classList.toggle('active', parseInt(b.dataset.notifyhours,10) === cardNotifyHours);
  });
  const custom = document.getElementById('cardNotifyCustom');
  if(custom) custom.style.display = (cardNotifyMode === 'custom') ? 'block' : 'none';
  const hint = document.getElementById('cardNotifyHint');
  if(hint){
    const rule = (cardNotifyMode === 'custom')
      ? { days:cardNotifyDays, hours:cardNotifyHours }
      : notifySettings;
    hint.textContent = t('card.notify.hint', { d:rule.days, h:rule.hours });
  }
}

function updateCardColorModeUI(){
  // Scoped: the text buttons share .color-mode-btn for styling, and a global
  // query would strip their .active (they carry no data-colormode).
  document.querySelectorAll('#cardColorField .color-mode-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.colormode === cardColorMode);
  });
  const wrap = document.getElementById('cardCustomColorWrap');
  if(wrap) wrap.style.display = (cardColorMode === 'custom') ? 'flex' : 'none';
}
function setCardColorMode(mode){
  cardColorMode = ['category','status','custom'].includes(mode) ? mode : 'category';
  updateCardColorModeUI();
}
function setCardTextMode(mode){
  cardTextMode = (mode === 'custom') ? 'custom' : 'default';
  updateCardTextModeUI();
}
function updateCardTextModeUI(){
  document.querySelectorAll('#cardTextColorField .text-mode-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.textmode === cardTextMode);
  });
  const wrap = document.getElementById('cardTextColorWrap');
  if(wrap) wrap.style.display = (cardTextMode === 'custom') ? 'flex' : 'none';
  updateCardTextColorHint();
}
// Say the ratio out loud rather than quietly fixing the colour.
function updateCardTextColorHint(){
  const hint = document.getElementById('cardTextColorHint');
  if(!hint) return;
  if(cardTextMode !== 'custom'){ hint.textContent = ''; return; }
  const board = getCurrentRoom();
  const ink = document.getElementById('cardTextColor').value;
  const status = document.getElementById('cardStatus');
  const bg = (board && status && board.colors[status.value]) || fallbackColor();
  const r = contrast(bg, ink);
  hint.textContent = t('card.textColor.hint', { r: r.toFixed(2) }) + (r < 4.5 ? ' — ' + t('card.textColor.low') : '');
  hint.style.color = r < 4.5 ? 'var(--c-danger)' : 'var(--c-muted)';
}

// Status / Category / due-date rows all come from the room, so they're rebuilt
// whenever the room behind the modal changes.
function fillCardModalRoomFields(board, card, presetStatus, presetDate){
  document.getElementById('cardBoard').value = board.key;

  const statusSel = document.getElementById('cardStatus');
  statusSel.innerHTML = board.statuses.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  statusSel.value = card ? card.status : (presetStatus || board.statuses[0]);

  const categoryField = document.getElementById('cardCategoryField');
  const categorySel = document.getElementById('cardCategory');
  if(board.categoryOptions && board.categoryOptions.length){
    categoryField.style.display = 'block';
    categorySel.innerHTML = board.categoryOptions.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    categorySel.value = (card && board.categoryOptions.includes(card.category)) ? card.category : board.categoryOptions[0];
  }else{
    categoryField.style.display = 'none';
  }

  renderCardDueDatesList(board, card, presetDate);
}

// opts: { presetDate:'YYYY-MM-DD', allowRoomChange:true }  — allowRoomChange is
// used by the Main Calendar, where a new card has to pick its owning room.
function openCardModal(board, card, presetStatus, opts){
  opts = opts || {};
  cardEditing = card ? { boardKey: board.key, id: card.id } : { boardKey: board.key, id: null };
  cardPresetDate = card ? null : (opts.presetDate || null);

  document.getElementById('cardModalTitle').textContent = card ? t('card.edit') : t('card.add');
  document.getElementById('cardId').value = card ? card.id : '';
  document.getElementById('cardTopic').value = card ? card.topic : '';
  document.getElementById('cardDetails').value = card ? (card.details || '') : '';

  cardColorMode = card ? (card.colorMode || 'category') : 'category';
  cardTextMode = (card && card.textMode === 'custom') ? 'custom' : 'default';
  const textInput = document.getElementById('cardTextColor');
  if(textInput) textInput.value = (card && card.textColor) || '#FFFFFF';
  const customInput = document.getElementById('cardCustomColor');
  if(customInput) customInput.value = (card && card.customColor) ? card.customColor : '#FB7562';
  updateCardColorModeUI();
  updateCardTextModeUI();   // must run per open: the state is module-level and sticks

  const rule = cardNotifyRule(card);
  cardNotifyMode  = rule.custom ? 'custom' : 'default';
  cardNotifyDays  = rule.days;
  cardNotifyHours = rule.hours;
  updateCardNotifyUI();

  // Room picker: only when creating from the Main Calendar and more than one room exists.
  const roomField = document.getElementById('cardRoomField');
  const roomSel = document.getElementById('cardRoom');
  const showRoomPicker = !!opts.allowRoomChange && !card && rooms.length > 1;
  if(roomField){
    roomField.style.display = showRoomPicker ? 'block' : 'none';
    if(showRoomPicker){
      roomSel.innerHTML = rooms.map(r=>`<option value="${r.id}">${escapeHtml(roomLabel(r))}</option>`).join('');
      roomSel.value = board.id;
    }
  }

  fillCardModalRoomFields(board, card, presetStatus, cardPresetDate);


  document.getElementById('cardModalOverlay').classList.add('show');
}
function closeCardModal(){
  document.getElementById('cardModalOverlay').classList.remove('show');
}

// A card may belong to a room that isn't the one on screen (Main Calendar),
// so repaint only the surfaces that actually show it.
function refreshAfterCardChange(board){
  refreshIfVisible(board);
  if(currentView && currentView.type === 'home') renderHomePage();
  if(currentView && currentView.type === 'maincal') renderMainCalendar();
  if(currentView && currentView.type === 'notify') renderNotificationPage();
  renderSidebar();   // the Notification badge counts across every room
}

function saveCardModal(){
  const boardKey = document.getElementById('cardBoard').value;
  const board = BOARDS[boardKey] || getCurrentRoom(); if(!board) return;
  const topic = document.getElementById('cardTopic').value.trim();
  const details = document.getElementById('cardDetails').value.trim();
  const status = document.getElementById('cardStatus').value;

  if(!topic){ alert(t('alert.needTopic')); return; }

  const dueDates = {};
  document.querySelectorAll('#cardDueDatesList .cdr-input').forEach(inp=>{
    if(inp.value) dueDates[inp.dataset.status] = inp.value;
  });
  // A time without a date has nothing to attach to, so it's dropped.
  const dueTimes = {};
  document.querySelectorAll('#cardDueDatesList .cdr-time').forEach(inp=>{
    if(inp.value && dueDates[inp.dataset.status]) dueTimes[inp.dataset.status] = inp.value;
  });

  if(!dueDates[board.completeStatus]){
    alert(t('alert.needCompleteDue',{s:board.completeStatus}));
    return;
  }

  const id = cardEditing.id || cardUid();
  const cardData = { id, topic, details, status, dueDates, dueTimes, colorMode: cardColorMode };
  if(cardColorMode === 'custom'){
    cardData.customColor = document.getElementById('cardCustomColor').value;
  }
  // "default" means the field is absent, so the app-wide setting keeps applying.
  if(cardTextMode === 'custom'){
    cardData.textMode = 'custom';
    cardData.textColor = document.getElementById('cardTextColor').value.toUpperCase();
  }
  // Only an explicit override is stored; "default" means "no notify field".
  if(cardNotifyMode === 'custom'){
    cardData.notify = { mode:'custom', days:cardNotifyDays, hours:cardNotifyHours };
  }
  if(board.categoryOptions){
    cardData.category = document.getElementById('cardCategory').value;
  }

  if(cardEditing.id){
    board.cards = board.cards.map(c=> c.id === id ? cardData : c);
  }else{
    board.cards.push(cardData);
  }
  saveBoardCards(board);
  closeCardModal();
  refreshAfterCardChange(board);
}

function deleteCard(board, id){
  if(!confirm(t('confirm.deleteCard'))) return;
  board.cards = board.cards.filter(c=>c.id!==id);
  saveBoardCards(board);
  refreshAfterCardChange(board);
}

