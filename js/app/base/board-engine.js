"use strict";
/* js/app/base/board-engine.js
   BOARD ENGINE — cards / kanban / calendar / list
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   BOARD ENGINE — cards, kanban, calendar, list, completed.
   Cards live inside their room object, so persisting a board's
   cards means writing the whole rooms list.
   ============================================================ */
async function saveBoardCards(board){
  try{
    saveRooms();
  }catch(e){
    // Unreachable in practice: saveRooms() swallows and reports its own errors.
    logAppError('บันทึกการ์ดไม่สำเร็จ', e);
    alertSaveFailure(e);
  }
}

function getCardTaskInstances(board){
  const instances = [];
  const eligible = getDueDateEligibleStatuses(board);
  board.cards.forEach(c=>{
    eligible.forEach(task=>{
      const date = c.dueDates && c.dueDates[task];
      if(date){
        instances.push({
          cardId: c.id,
          topic: c.topic,
          task,
          currentStatus: c.status,
          category: c.category,
          colorMode: c.colorMode || 'category',
          customColor: c.customColor || null,
          textMode: c.textMode || 'default',
          textColor: c.textColor || null,
          date,
          time: (c.dueTimes && c.dueTimes[task]) || '',
          overdue: (task === c.status) && !board.terminal.includes(c.status) && daysUntilDue(date) < 0
        });
      }
    });
  });
  return instances;
}

// How a calendar chip is coloured is a per-card choice:
//   'category' (default) → the room's colour for that card's category
//   'status'             → the room's colour for the status this chip represents
//   'custom'             → a colour picked on the card itself
function chipColor(inst, room){
  const mode = inst.colorMode || 'category';
  if(mode === 'custom' && inst.customColor) return inst.customColor;
  if(mode === 'status') return room.colors[inst.task] || fallbackColor();
  return (room.categoryColors && room.categoryColors[inst.category]) || room.colors[inst.task] || fallbackColor();
}

function isCardOverdue(card, board){
  const due = getActiveDueDate(card, board);
  return !!(due && !board.terminal.includes(card.status) && daysUntilDue(due) < 0);
}

function migrateLegacyOverdueStatus(board){
  // Older versions overwrote card.status with the literal "Overdue" when a due date passed.
  // "Overdue" is now a computed flag, so any card carrying an unknown status is reset to the
  // board's first status. Also migrates the old single card.dueDate into the per-status map.
  let changed = false;
  board.cards.forEach(c=>{
    if(!board.statuses.includes(c.status)){
      c.status = board.statuses[0];
      changed = true;
    }
    if(!c.dueDates){
      c.dueDates = {};
      if(c.dueDate && !board.excludeDueDateStatuses.includes(c.status)){
        c.dueDates[c.status] = c.dueDate;
      }
      delete c.dueDate;
      changed = true;
    }
  });
  if(changed) saveBoardCards(board);
}

function renderKanban(board){
  const container = document.getElementById('jigsaw-kanban');
  if(!container) return;
  container.innerHTML = board.statuses.map(status=>{
    const isCompletePortal = status === board.completeStatus;
    // Cards that reach the "complete" status live in the Completed sub-page, not on the Board —
    // this column stays visible only as a drop target.
    const cards = isCompletePortal ? [] : board.cards.filter(c=>c.status===status);
    const color = board.colors[status] || fallbackColor();
    return `<div class="kcol" data-status="${escapeHtml(status)}" data-board="${board.key}">
      <div class="kcol-head">
        <span class="kcol-dot" style="background:${color}"></span>
        <span>${escapeHtml(status)}</span>
        <span class="kcol-count">${cards.length}</span>
        ${isCompletePortal ? '' : `<button class="kcol-add" data-board="${board.key}" data-status="${escapeHtml(status)}" title="${t('kanban.addInStatus')}">+</button>`}
      </div>
      ${isCompletePortal ? '<div class="kcol-hint">'+t('kanban.completeHint')+'</div>' : ''}
      <div class="kcol-body">
        ${cards.length===0 ? '<div class="kcol-empty">'+t('kanban.empty')+'</div>' : cards.map(c=>renderCardHtml(c, board)).join('')}
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.kcard').forEach(el=>{
    el.addEventListener('dragstart', e=>{
      e.dataTransfer.setData('text/plain', el.dataset.id);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', ()=> el.classList.remove('dragging'));
  });
  container.querySelectorAll('.kcol').forEach(col=>{
    col.addEventListener('dragover', e=>{ e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', ()=> col.classList.remove('drag-over'));
    col.addEventListener('drop', e=>{
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      const card = board.cards.find(c=>c.id===id);
      if(card && card.status !== newStatus){
        card.status = newStatus;
        saveBoardCards(board);
        renderKanban(board);
        renderCalendar(board);
      }
    });
  });
}

function renderCardHtml(c, board){
  const overdue = isCardOverdue(c, board);
  const color = board.colors[c.status] || fallbackColor();
  const activeDue = getActiveDueDate(c, board);
  const activeTime = getActiveDueTime(c, board);
  let dueLabel = '';
  if(activeDue){
    const d = new Date(activeDue+'T00:00:00');
    dueLabel = d.getDate().toString().padStart(2,'0')+' '+monthName(d.getMonth()+1);
  }
  return `<div class="kcard" draggable="true" data-id="${c.id}" data-board="${board.key}">
    <div class="kcard-actions">
      <button class="kcard-edit" title="${t('action.edit')}">✏️</button>
      <button class="kcard-del" title="${t('action.delete')}">🗑️</button>
    </div>
    <div class="kcard-topic">${escapeHtml(c.topic)}</div>
    <div class="kcard-status-row">
      <span class="kcard-status" style="color:${inkFor(color, panelColor())}">${escapeHtml(c.status)}</span>
      ${overdue ? '<span class="overdue-badge">'+t('badge.overdue')+'</span>' : ''}
      ${c.category ? (()=>{ const cc = board.categoryColors[c.category] || fallbackColor();
        return `<span class="pill" style="background:${cc}; color:${resolveInk(cc, c)}; font-size:9.5px;">${escapeHtml(c.category)}</span>`; })() : ''}
    </div>
    ${c.details ? `<div class="kcard-details">${escapeHtml(c.details)}</div>` : ''}
    ${dueLabel ? `<div class="kcard-foot"><span class="due-pill ${overdue?'overdue':''}">${dueLabel}${activeTime ? ' · '+escapeHtml(activeTime) : ''}</span></div>` : ''}
  </div>`;
}

function getMonthMatrix(date){
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month+1, 0).getDate();
  let startOffset = firstDay.getDay() - 1;
  if(startOffset < 0) startOffset = 6;
  const cells = [];
  for(let i=0;i<startOffset;i++) cells.push(null);
  for(let d=1; d<=daysInMonth; d++){
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({ day:d, iso });
  }
  while(cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function renderCalendar(board){
  const label = document.getElementById('jigsaw-cal-label');
  const grid = document.getElementById('jigsaw-calendar');
  if(!grid) return;
  const y = board.calDate.getFullYear();
  const m = board.calDate.getMonth();
  label.textContent = `${monthName(m+1)} ${y}`;

  const todayIso = localIso();
  const cells = getMonthMatrix(board.calDate);
  const instances = getCardTaskInstances(board);

  grid.innerHTML = cells.map(cell=>{
    if(!cell) return `<div class="cal-cell empty"></div>`;
    const todayInstances = sortDayInstances(instances.filter(inst=> inst.date === cell.iso));
    const isToday = cell.iso === todayIso;
    return `<div class="cal-cell ${isToday?'today':''}" data-iso="${cell.iso}" data-board="${board.key}">
      <div class="cal-daynum">${cell.day}</div>
      <div class="cal-cell-chips">
      ${todayInstances.map(inst=>{
        const color = chipColor(inst, board);
        return `<div class="cal-chip ${inst.overdue?'overdue':''}" draggable="true" style="background:${color}; color:${resolveInk(color, inst)}" data-id="${inst.cardId}" data-task="${escapeHtml(inst.task)}" data-board="${board.key}" title="${escapeHtml(inst.topic)} — ${t('chip.task')} ${escapeHtml(inst.task)} — Current Status: ${escapeHtml(inst.currentStatus)}${inst.category?' — Category: '+escapeHtml(inst.category):''}${inst.overdue?' — '+t('chip.overdue'):''}">
          <div class="cal-chip-topic">${inst.time ? '<span class="cal-chip-time">'+escapeHtml(inst.time)+'</span> ' : ''}${escapeHtml(inst.topic)}</div>
          <div class="cal-chip-status-row"><span class="cal-chip-status">${t('chip.task')} ${escapeHtml(inst.task)}</span></div>
          <div class="cal-chip-status-row">
            <span class="cal-chip-status">${t('chip.current')} ${escapeHtml(inst.currentStatus)}</span>
            ${inst.overdue ? '<span class="cal-chip-overdue-badge">'+t('chip.overdue')+'</span>' : ''}
          </div>
        </div>`;
      }).join('')}
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.cal-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      const b = BOARDS[chip.dataset.board];
      const card = b.cards.find(c=>c.id===chip.dataset.id);
      if(card) openCardModal(b, card);
    });
    chip.addEventListener('dragstart', (e)=>{
      e.dataTransfer.setData('text/plain', JSON.stringify({ id: chip.dataset.id, task: chip.dataset.task }));
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', ()=> chip.classList.remove('dragging'));
  });

  grid.querySelectorAll('.cal-cell[data-iso]').forEach(cell=>{
    cell.addEventListener('click', (e)=>{
      if(e.target.closest('.cal-chip')) return;   // chips have their own handler
      openCardModal(board, null, null, { presetDate: cell.dataset.iso });
    });
    cell.addEventListener('dragover', (e)=>{ e.preventDefault(); cell.classList.add('drag-over'); });
    cell.addEventListener('dragleave', ()=> cell.classList.remove('drag-over'));
    cell.addEventListener('drop', (e)=>{
      e.preventDefault();
      cell.classList.remove('drag-over');
      let payload;
      try{ payload = JSON.parse(e.dataTransfer.getData('text/plain')); }catch(err){ return; }
      const newIso = cell.dataset.iso;
      const card = board.cards.find(c=>c.id===payload.id);
      if(card && payload.task && card.dueDates && card.dueDates[payload.task] !== newIso){
        card.dueDates[payload.task] = newIso;
        saveBoardCards(board);
        refreshBoard(board);
      }
    });
  });
}

function populateListFilterStatus(boardKey){
  const board = getCurrentRoom(); if(!board) return;
  const sel = document.getElementById('jigsaw-list-filter-status');
  if(!sel) return;
  // Rebuilt every render because statuses can change from the Setting page.
  const current = sel.value || 'all';
  sel.innerHTML = '<option value="all">'+t('filter.all')+'</option>' +
    board.statuses.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  sel.value = (current === 'all' || board.statuses.includes(current)) ? current : 'all';
}

// Category options differ per room, so the filter dropdown is rebuilt each render.
function populateListFilterCategory(){
  const board = getCurrentRoom(); if(!board) return;
  const sel = document.getElementById('jigsaw-list-filter-category');
  if(!sel) return;
  const wanted = board.listCategoryFilter || 'all';
  sel.innerHTML = '<option value="all">'+t('filter.all')+'</option>' +
    board.categoryOptions.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = (wanted === 'all' || board.categoryOptions.includes(wanted)) ? wanted : 'all';
}

// Sort options: the two grouping sorts plus one "<status> Date" entry per status.
function populateListSort(){
  const board = getCurrentRoom(); if(!board) return;
  const sel = document.getElementById('jigsaw-list-sort');
  if(!sel) return;
  const wanted = board.listSort || 'due';
  sel.innerHTML =
    `<option value="due">${escapeHtml(t('sort.due'))}</option>` +
    `<option value="status">${escapeHtml(t('sort.status'))}</option>` +
    `<option value="category">${escapeHtml(t('sort.category'))}</option>` +
    board.statuses.map(st=>`<option value="due:${escapeHtml(st)}">${escapeHtml(t('sort.dueOf',{s:st}))}</option>`).join('');
  const valid = ['due','status','category'].includes(wanted) ||
                (wanted.startsWith('due:') && board.statuses.includes(wanted.slice(4)));
  sel.value = valid ? wanted : 'due';
  if(!valid) board.listSort = 'due';
}

function makeListComparator(board){
  const sort = board.listSort || 'due';
  // Cards falling on the same day are always broken apart by their time.
  const byActive = (a,b)=> compareByDateTime(
    getActiveDueDate(a,board), getActiveDueTime(a,board),
    getActiveDueDate(b,board), getActiveDueTime(b,board));

  if(sort === 'status'){
    return (a,b)=>{
      const d = board.statuses.indexOf(a.status) - board.statuses.indexOf(b.status);
      return d !== 0 ? d : byActive(a,b);
    };
  }
  if(sort === 'category'){
    return (a,b)=>{
      const d = board.categoryOptions.indexOf(a.category) - board.categoryOptions.indexOf(b.category);
      return d !== 0 ? d : byActive(a,b);
    };
  }
  if(sort.startsWith('due:')){
    const st = sort.slice(4);
    return (a,b)=> compareByDateTime(
      a.dueDates && a.dueDates[st], a.dueTimes && a.dueTimes[st],
      b.dueDates && b.dueDates[st], b.dueTimes && b.dueTimes[st]);
  }
  // 'due' — the due date of each card's own current status
  return byActive;
}

// The List view's date columns are one-per-status, so the header is rebuilt
// from the current statuses rather than hardcoded in HTML.
function renderListHeader(boardKey){
  const board = getCurrentRoom(); if(!board) return;
  const eligible = getDueDateEligibleStatuses(board);
  const thead = document.getElementById('jigsaw-list-thead');
  if(!thead) return;
  thead.innerHTML = `<tr>
    <th>Topic</th><th>Current Status</th>${board.categoryOptions ? '<th>Category</th>' : ''}
    ${eligible.map(s=>`<th>${escapeHtml(s)} Date</th>`).join('')}
    <th></th>
  </tr>`;
}

function renderCardList(boardKey){
  const board = getCurrentRoom(); if(!board) return;
  const eligible = getDueDateEligibleStatuses(board);
  renderListHeader(boardKey);
  populateListFilterStatus(boardKey);
  populateListFilterCategory();
  populateListSort();
  const f = board.listFilters;
  const list = board.cards.filter(c=>{
    if(c.status === board.completeStatus) return false;
    if(f.status !== 'all' && c.status !== f.status) return false;
    if(board.categoryOptions && board.listCategoryFilter !== 'all' && c.category !== board.listCategoryFilter) return false;
    const due = getActiveDueDate(c, board);
    if(f.from && (!due || due < f.from)) return false;
    if(f.to && (!due || due > f.to)) return false;
    return true;
  }).sort(makeListComparator(board));

  const tbody = document.getElementById('jigsaw-list-tbody');
  const empty = document.getElementById('jigsaw-list-empty');

  if(list.length === 0){
    tbody.innerHTML = '';
    empty.style.display = 'block';
    document.getElementById('jigsaw-list-pagination').innerHTML = '';
    document.getElementById('jigsaw-list-pagination-top').innerHTML = '';
  }else{
    empty.style.display = 'none';
    const { items: pageItems, page, totalPages } = paginate(list, board.listPage || 1);
    board.listPage = page;
    tbody.innerHTML = pageItems.map(c=>{
      const currentColor = board.colors[c.status] || fallbackColor();
      const overdue = isCardOverdue(c, board);
      const dateCells = eligible.map(status=>{
        const raw = c.dueDates && c.dueDates[status];
        if(!raw) return `<td>-</td>`;
        const d = new Date(raw+'T00:00:00');
        const label = d.getDate().toString().padStart(2,'0')+' '+monthName(d.getMonth()+1)+' '+d.getFullYear();
        const time = (c.dueTimes && c.dueTimes[status]) || '';
        const isCurrentCol = status === c.status;
        const showOverdue = isCurrentCol && overdue;
        return `<td style="${isCurrentCol ? 'background:'+board.colors[status]+'22; font-weight:700;' : ''}">
          ${label}
          ${time ? '<span class="cell-time">'+escapeHtml(time)+'</span>' : ''}
          ${showOverdue ? '<span class="overdue-badge" style="margin-left:6px;">'+t('badge.overdue')+'</span>' : ''}
        </td>`;
      }).join('');
      return `<tr data-id="${c.id}">
        <td>${escapeHtml(c.topic)}</td>
        <td>
          <select class="card-list-status-select" style="background:${currentColor}; color:${resolveInk(currentColor, c)}; border:none; font-weight:700; font-size:11.5px;">
            ${board.statuses.map(s=>`<option value="${s}" ${s===c.status?'selected':''}>${s}</option>`).join('')}
          </select>
        </td>
        ${board.categoryOptions ? `<td>${c.category ? (()=>{ const cc = board.categoryColors[c.category] || fallbackColor();
          return `<span class="pill" style="background:${cc}; color:${resolveInk(cc, c)}">${escapeHtml(c.category)}</span>`; })() : '-'}</td>` : ''}
        ${dateCells}
        <td style="white-space:nowrap;">
          <button class="btn-icon list-card-edit" title="${t('action.edit')}">✏️</button>
          <button class="btn-icon list-card-del" title="${t('action.delete')}">🗑️</button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.card-list-status-select').forEach(sel=>{
      sel.addEventListener('change', (e)=>{
        const id = e.target.closest('tr').dataset.id;
        const card = board.cards.find(c=>c.id===id);
        if(card){
          card.status = e.target.value;
          saveBoardCards(board);
          refreshBoard(board);
        }
      });
    });
    tbody.querySelectorAll('.list-card-edit').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const id = e.target.closest('tr').dataset.id;
        const card = board.cards.find(c=>c.id===id);
        if(card) openCardModal(board, card);
      });
    });
    tbody.querySelectorAll('.list-card-del').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const id = e.target.closest('tr').dataset.id;
        // deleteCard() confirms, persists and repaints the board; the List view
        // is a board surface, so re-render it too.
        const before = board.cards.length;
        deleteCard(board, id);
        if(board.cards.length !== before) renderCardList();
      });
    });
    renderPaginationControls(['jigsaw-list-pagination-top', 'jigsaw-list-pagination'], page, totalPages, (p)=>{ board.listPage = p; renderCardList(boardKey); });
  }
}

function renderCompletedList(boardKey){
  const board = getCurrentRoom(); if(!board) return;
  const f = board.completedFilters;
  const list = board.cards.filter(c=>{
    if(c.status !== board.completeStatus) return false;
    if(f.search && !c.topic.toLowerCase().includes(f.search.toLowerCase())) return false;
    const due = getActiveDueDate(c, board);
    if(f.from && (!due || due < f.from)) return false;
    if(f.to && (!due || due > f.to)) return false;
    return true;
  }).sort((a,b)=>{
    // Most recently completed first. Blanks always sink, so this can't just be
    // a negated compareByDateTime (that would float the blanks to the top).
    const dA = getActiveDueDate(a,board), dB = getActiveDueDate(b,board);
    if(!dA && !dB) return 0;
    if(!dA) return 1;
    if(!dB) return -1;
    if(dA !== dB) return dB.localeCompare(dA);
    const tA = getActiveDueTime(a,board), tB = getActiveDueTime(b,board);
    if(!tA && !tB) return 0;
    if(!tA) return 1;
    if(!tB) return -1;
    return tB.localeCompare(tA);
  });

  const tbody = document.getElementById('jigsaw-completed-tbody');
  const empty = document.getElementById('jigsaw-completed-empty');

  if(list.length === 0){
    tbody.innerHTML = '';
    empty.style.display = 'block';
    document.getElementById('jigsaw-completed-pagination').innerHTML = '';
    document.getElementById('jigsaw-completed-pagination-top').innerHTML = '';
  }else{
    empty.style.display = 'none';
    const { items: pageItems, page, totalPages } = paginate(list, board.completedPage || 1);
    board.completedPage = page;
    tbody.innerHTML = pageItems.map(c=>{
      const color = board.colors[c.status] || fallbackColor();
      const activeDue = getActiveDueDate(c, board);
      let dueLabel = '-';
      if(activeDue){
        const d = new Date(activeDue+'T00:00:00');
        dueLabel = d.getDate().toString().padStart(2,'0')+' '+monthName(d.getMonth()+1)+' '+d.getFullYear();
      }
      return `<tr data-id="${c.id}">
        <td>${escapeHtml(c.topic)}</td>
        <td>
          <select class="completed-status-select" style="background:${color}; color:${resolveInk(color, c)}; border:none; font-weight:700; font-size:11.5px;">
            ${board.statuses.map(s=>`<option value="${s}" ${s===c.status?'selected':''}>${s}</option>`).join('')}
          </select>
        </td>
        <td>${dueLabel}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.completed-status-select').forEach(sel=>{
      sel.addEventListener('change', (e)=>{
        const id = e.target.closest('tr').dataset.id;
        const card = board.cards.find(c=>c.id===id);
        if(card){
          card.status = e.target.value;
          saveBoardCards(board);
          refreshBoard(board);
        }
      });
    });
    renderPaginationControls(['jigsaw-completed-pagination-top', 'jigsaw-completed-pagination'], page, totalPages, (p)=>{ board.completedPage = p; renderCompletedList(boardKey); });
  }
}

function refreshBoard(board){
  renderKanban(board);
  renderCalendar(board);
  renderCardList(board.key);
  renderCompletedList(board.key);
}

