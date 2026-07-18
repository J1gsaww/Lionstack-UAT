"use strict";
/* js/app/base/home.js
   HOME — dashboard over rooms
   Extracted verbatim from the original app.js (same load order, shared
   global scope). Behaviour is unchanged. */
/* ============================================================
   HOME — a dashboard over every room.

     • one large pie for a "featured" room (you pick which)
     • four small pies for the remaining slots (MAX_ROOMS = 5 total);
       slots without a room render as an empty placeholder card
     • each pie can be grouped by Status (default) or Category, and
       always uses the colours configured for that room
     • today's tasks, gathered from every room
     • Complete vs In Progress proportions, per room and overall

   Which room is featured, and each chart's grouping, are view
   preferences — they live in their own localStorage key rather than
   inside the rooms, so exporting rooms stays clean.
   ============================================================ */
const HOME_STORAGE_KEY = 'app_home_v1';
let homeSettings = { featured:null, modes:{} };

function loadHomeSettings(){
  try{
    const raw = Store.getRaw(HOME_STORAGE_KEY);
    if(!raw) return { featured:null, modes:{} };
    const p = JSON.parse(raw);
    return { featured: p.featured || null, modes: (p.modes && typeof p.modes === 'object') ? p.modes : {} };
  }catch(e){
    logAppError('โหลดการตั้งค่าหน้า Home ไม่สำเร็จ', e);
    return { featured:null, modes:{} };
  }
}
function saveHomeSettings(){
  try{ Store.setRaw(HOME_STORAGE_KEY, JSON.stringify(homeSettings)); }
  catch(e){ logAppError('บันทึกการตั้งค่าหน้า Home ไม่สำเร็จ', e); }
}
function homeChartMode(roomId){
  return homeSettings.modes[roomId] === 'category' ? 'category' : 'status';
}
// The featured room, falling back to the first room if the saved one is gone.
function featuredRoom(){
  if(homeSettings.featured && BOARDS[homeSettings.featured]) return BOARDS[homeSettings.featured];
  return rooms[0] || null;
}
// Featured room first, then the rest in room order, padded to MAX_ROOMS.
function homeRoomSlots(){
  const first = featuredRoom();
  const rest = rooms.filter(r=> !first || r.id !== first.id);
  const ordered = first ? [first, ...rest] : [];
  const slots = [];
  for(let i = 0; i < MAX_ROOMS; i++) slots.push(ordered[i] || null);
  return slots;
}

/* ---------------- Pie ---------------- */
// Only non-empty groups become slices; the colours come straight from the
// room's Status/Category config so the pie matches the board.
function pieData(room, mode){
  const cfg = (mode === 'category') ? room.categoryConfig : room.statusConfig;
  const counts = {};
  cfg.forEach(x=>{ counts[x.name] = 0; });
  room.cards.forEach(c=>{
    const key = (mode === 'category') ? c.category : c.status;
    if(key in counts) counts[key]++;
  });
  return cfg.map(x=>({ name:x.name, color:x.color, value:counts[x.name] })).filter(e=> e.value > 0);
}

function pieSvg(entries, size){
  const total = entries.reduce((sum,e)=> sum + e.value, 0);
  if(total === 0) return '';
  const r = size / 2;
  const inner = r * 0.58;                       // donut hole
  let body;

  if(entries.length === 1){
    // A single group would make a degenerate arc (start point === end point).
    body = `<circle cx="${r}" cy="${r}" r="${r}" fill="${entries[0].color}"></circle>`;
  }else{
    let a0 = -Math.PI / 2;                      // start at 12 o'clock
    body = entries.map(e=>{
      const a1 = a0 + (e.value / total) * Math.PI * 2;
      const x0 = r + r * Math.cos(a0), y0 = r + r * Math.sin(a0);
      const x1 = r + r * Math.cos(a1), y1 = r + r * Math.sin(a1);
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      a0 = a1;
      return `<path d="M${r},${r} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${e.color}"></path>`;
    }).join('');
  }

  return `<svg class="pie-svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">
    ${body}
    <circle cx="${r}" cy="${r}" r="${inner}" fill="var(--c-panel)"></circle>
    <text x="${r}" y="${r - 2}" text-anchor="middle" class="pie-total">${total}</text>
    <text x="${r}" y="${r + 14}" text-anchor="middle" class="pie-total-label">${escapeHtml(t('home.cards'))}</text>
  </svg>`;
}

function pieLegend(entries, total){
  return entries.map(e=>{
    const pct = total ? Math.round((e.value / total) * 100) : 0;
    return `<div class="pie-legend-row">
      <span class="pie-legend-dot" style="background:${e.color}"></span>
      <span class="pie-legend-name">${escapeHtml(e.name)}</span>
      <span class="pie-legend-value">${e.value} · ${pct}%</span>
    </div>`;
  }).join('');
}

function chartCardHtml(room, size, featured){
  if(!room){
    return `<div class="panel home-chart home-chart-empty">
      <div class="home-empty-tag">${escapeHtml(t('home.noRoom'))}</div>
    </div>`;
  }
  const mode = homeChartMode(room.id);
  const entries = pieData(room, mode);
  const total = entries.reduce((s,e)=> s + e.value, 0);

  const modeToggle = `<div class="home-mode-toggle">
      <button type="button" class="home-mode-btn ${mode==='status'?'active':''}" data-room="${room.id}" data-mode="status">${escapeHtml(t('home.byStatus'))}</button>
      <button type="button" class="home-mode-btn ${mode==='category'?'active':''}" data-room="${room.id}" data-mode="category">${escapeHtml(t('home.byCategory'))}</button>
    </div>`;

  const featuredPicker = featured ? `<div class="home-featured-picker">
      <label for="homeFeaturedSelect">${escapeHtml(t('home.showRoom'))}</label>
      <select id="homeFeaturedSelect">
        ${rooms.map(r=>`<option value="${r.id}" ${r.id===room.id?'selected':''}>${escapeHtml(roomLabel(r))}</option>`).join('')}
      </select>
    </div>` : `<div class="home-chart-title">${escapeHtml(roomLabel(room))}</div>`;

  const body = total === 0
    ? `<div class="home-chart-nodata">${escapeHtml(t('home.noCards'))}</div>`
    : `<div class="home-chart-body">
         ${pieSvg(entries, size)}
         <div class="pie-legend">${pieLegend(entries, total)}</div>
       </div>`;

  return `<div class="panel home-chart ${featured?'home-chart-featured':''}">
    <div class="home-chart-head">${featuredPicker}${modeToggle}</div>
    ${body}
  </div>`;
}

/* ---------------- Today ---------------- */
// "Due today" uses the same effective deadline as the Notification page:
// the current status's date, falling back to the mandatory completed date.
function todayTasks(){
  const today = localIso();
  const out = [];
  rooms.forEach(room=>{
    room.cards.forEach(card=>{
      if(card.status === room.completeStatus) return;
      const parts = cardDeadlineParts(card, room);
      if(parts && parts.date === today) out.push({ room, card, time: parts.time || '' });
    });
  });
  return out.sort((a,b)=>{
    if(!a.time && !b.time) return 0;
    if(!a.time) return 1;
    if(!b.time) return -1;
    return a.time.localeCompare(b.time);
  });
}

function homeStatusColor(it){ return it.room.colors[it.card.status] || fallbackColor(); }

function todayHtml(){
  const items = todayTasks();
  if(items.length === 0){
    return `<div class="home-today-empty">
      <div class="big">☀️</div>
      <span>${escapeHtml(t('home.today.empty'))}</span>
    </div>`;
  }
  return `<div class="home-today-list">${items.map((it,i)=>`
    <div class="home-today-item" data-index="${i}">
      <span class="home-today-time">${it.time ? escapeHtml(it.time) : '—'}</span>
      <span class="home-today-main">
        <span class="home-today-room">${escapeHtml(roomLabel(it.room))}</span>
        <span class="home-today-topic">${escapeHtml(it.card.topic)}</span>
      </span>
      <span class="pill" style="background:${homeStatusColor(it)}; color:${resolveInk(homeStatusColor(it), it.card)}">${escapeHtml(it.card.status)}</span>
    </div>`).join('')}</div>`;
}

/* ---------------- Progress ---------------- */
// The locked "complete" status counts as done; every other status is In Progress.
function roomProgress(room){
  const total = room.cards.length;
  const done = room.cards.filter(c=> c.status === room.completeStatus).length;
  return { total, done, wip: total - done, pct: total ? Math.round((done / total) * 100) : 0 };
}

function progressRow(label, p, doneColor){
  const donePct = p.total ? (p.done / p.total) * 100 : 0;
  const wip = wipColor(doneColor, panelColor());
  return `<div class="home-progress-row">
    <div class="home-progress-head">
      <span class="home-progress-label">${escapeHtml(label)}</span>
      <span class="home-progress-pct">${p.pct}%</span>
    </div>
    <div class="home-progress-bar" title="${p.done}/${p.total}">
      ${p.total === 0
        ? `<div class="home-progress-none"></div>`
        : `<div class="home-progress-done" style="width:${donePct}%; background:${doneColor}"></div>
           <div class="home-progress-wip" style="width:${100-donePct}%; background:${wip}"></div>`}
    </div>
    <div class="home-progress-meta">
      ${p.total === 0
        ? escapeHtml(t('home.noCards'))
        : `${escapeHtml(t('home.complete'))} ${p.done} · ${escapeHtml(t('home.inProgress'))} ${p.wip} · ${escapeHtml(t('home.total'))} ${p.total}`}
    </div>
  </div>`;
}

function progressHtml(){
  const all = { total:0, done:0, wip:0, pct:0 };
  rooms.forEach(r=>{ const p = roomProgress(r); all.total += p.total; all.done += p.done; all.wip += p.wip; });
  all.pct = all.total ? Math.round((all.done / all.total) * 100) : 0;

  // The all-rooms row has no owning room to take a complete-status colour from.
  // Resolved to a hex, not left as var(): wipColor() has to do maths on it.
  return progressRow(t('home.allRooms'), all, currentTokens()['--c-accent']) +
    rooms.map(r=> progressRow(r.name, roomProgress(r), r.colors[r.completeStatus] || fallbackColor())).join('');
}

/* ---------------- Page ---------------- */
function renderHomePage(){
  const featWrap = document.getElementById('homeFeaturedChart');
  if(!featWrap) return;
  const slots = homeRoomSlots();

  featWrap.innerHTML = chartCardHtml(slots[0], 200, true);
  document.getElementById('homeSmallCharts').innerHTML =
    slots.slice(1).map(r=> chartCardHtml(r, 120, false)).join('');

  document.getElementById('homeTodayBody').innerHTML = todayHtml();
  document.getElementById('homeProgressBody').innerHTML = progressHtml();

  // Featured picker
  const sel = document.getElementById('homeFeaturedSelect');
  if(sel){
    sel.addEventListener('change', (e)=>{
      homeSettings.featured = e.target.value;
      saveHomeSettings();
      renderHomePage();
    });
  }
  // Per-chart grouping
  document.querySelectorAll('.home-mode-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      homeSettings.modes[btn.dataset.room] = btn.dataset.mode;
      saveHomeSettings();
      renderHomePage();
    });
  });
  // Today's items open their card
  const items = todayTasks();
  document.querySelectorAll('.home-today-item').forEach(el=>{
    el.addEventListener('click', ()=>{
      const it = items[parseInt(el.dataset.index, 10)];
      if(it) openCardModal(it.room, it.card);
    });
  });
}

