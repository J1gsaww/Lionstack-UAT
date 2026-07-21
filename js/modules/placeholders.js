/* ============================================================================
 * Placeholder pages — structure first, logic later.
 *
 * These exist so the sidebar shows the full shape of the app while each area is
 * still being designed. Every page here is intentionally empty apart from the
 * Employee Calendar, which renders a real (but blank) month grid.
 *
 * When one of these grows real behaviour, move it into its own module file and
 * delete its entry here.
 * ==========================================================================*/
(function(){
  const esc = (v)=> String(v==null?'':v).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const WEEKDAYS_TH = ['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'];
  const WEEKDAYS_EN = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const isEn = ()=> (window.appLang && window.appLang()) === 'en';

  // Monday-first month matrix; null = padding cell.
  function monthMatrix(date){
    const y = date.getFullYear(), m = date.getMonth();
    const dim = new Date(y, m+1, 0).getDate();
    let off = new Date(y, m, 1).getDay() - 1; if(off < 0) off = 6;
    const cells = [];
    for(let i=0;i<off;i++) cells.push(null);
    for(let d=1; d<=dim; d++) cells.push({ day:d, iso:`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` });
    while(cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  // A blank page with a short "not built yet" note.
  function makeStubModule(cfg){
    const ID = cfg.id;
    const subs = cfg.subpages || [];          // [{ id, th, en }]
    let sub = subs.length ? subs[0].id : null;
    const T = (k)=> window.moduleI18n(ID)(k);
    const th = { 'title': cfg.title.th, 'crumb': cfg.crumb.th, 'soon': 'ยังไม่เริ่มทำ — สร้างหน้าไว้ก่อนเพื่อให้เห็นภาพรวม' };
    const en = { 'title': cfg.title.en, 'crumb': cfg.crumb.en, 'soon': 'Not built yet — the page exists so the structure is visible' };
    subs.forEach(sp=>{ th['sub.'+sp.id] = sp.th; en['sub.'+sp.id] = sp.en; });
    window.registerModuleI18n(ID, { th, en });
    window.registerModule({
      id: ID,
      navLabel: cfg.title,
      pageId: 'page-' + ID,
      async onInit(){},
      mount(container){ this.render(); },
      render(){
        const container = document.getElementById('page-' + ID);
        if(!container) return;
        const self = this;
        const subnav = subs.length
          ? `<div class="acc-subnav store-subnav" id="${ID}Subnav">${subs.map(sp=>
              `<button type="button" class="acc-subnav-btn ${sp.id===sub?'active':''}" data-subpage="${sp.id}">${esc(T('sub.'+sp.id))}</button>`).join('')}</div>`
          : '';
        const heading = subs.length ? esc(T('sub.' + sub)) : '';
        container.innerHTML = `
          <div class="topbar">
            <h1>${esc(T('title'))}</h1>
            <div class="crumb">${esc(T('crumb'))}</div>
          </div>
          <div class="content">
            ${subnav}
            <div class="panel">
              <div class="art-empty" style="padding:52px 20px;">
                <div class="art-empty-ico">\u{1F6A7}</div>
                ${heading ? `<div style="font-weight:700; margin-bottom:4px;">${heading}</div>` : ''}
                <div>${esc(T('soon'))}</div>
              </div>
            </div>
          </div>`;
        const nav = container.querySelector('#' + ID + 'Subnav');
        if(nav) nav.addEventListener('click', function(e){
          const btn = e.target.closest('[data-subpage]');
          if(!btn) return;
          sub = btn.dataset.subpage;
          self.render();
        });
      }
    });
  }


  /* ---------------- Employee Calendar: a real, empty month grid ------------ */
  (function(){
    const ID = 'empCalendar';
    const K_LEAVE = 'mod_hr_leave';
    const T = (k)=> window.moduleI18n(ID)(k);
    let curDate = null;
    let leaves = [];          // [{ id, empId, empName, from, to, kind:'deduct'|'free', note, by, createdAt }]

    const iso = (d)=> `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const covers = (lv, dayIso)=> dayIso >= (lv.from||'') && dayIso <= (lv.to||lv.from||'');
    async function saveLeaves(){ await window.Store.set(K_LEAVE, leaves); }

    // Working days of leave inside a month — what payroll deducts from.
    window.hrLeaveDays = function(empId, monthKey, onlyDeduct){
      let n = 0;
      leaves.filter(lv=> lv.empId === empId && (!onlyDeduct || lv.kind === 'deduct')).forEach(lv=>{
        const from = new Date(lv.from), to = new Date(lv.to || lv.from);
        for(let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)){
          if(!monthKey || iso(d).slice(0,7) === monthKey) n++;
        }
      });
      return n;
    };

    window.registerModuleI18n(ID, {
      th: { 'title':'ปฏิทินพนักงาน', 'crumb':'ตารางงาน/วันลาของทีม', 'today':'วันนี้',
            'note':'คลิกที่วันเพื่อบันทึกวันลา',
            'addTitle':'บันทึกวันลา', 'employee':'พนักงาน', 'from':'เริ่มลา', 'to':'ถึงวันที่',
            'kind':'ประเภทการลา', 'deduct':'ลาแบบหักเงิน', 'free':'ลาแบบไม่หักเงิน',
            'noteField':'หมายเหตุ', 'save':'บันทึก', 'cancel':'ยกเลิก',
            'errEmp':'กรุณาเลือกพนักงาน', 'errRange':'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม',
            'delConfirm':'ลบรายการลานี้?', 'days':'วัน', 'noEmp':'ยังไม่มีพนักงานในระบบ',
            'deductHint':'หักเงิน = เงินเดือนพื้นฐาน ÷ 30 × จำนวนวันลา (ไปหักในหน้าเงินเดือน)',
            'periodClosed':'เดือนนี้ Authorize เงินเดือนแล้ว — ต้อง Unauthorize ก่อนจึงจะแก้วันลาได้' },
      en: { 'title':'Employee Calendar', 'crumb':'Team schedule and leave', 'today':'Today',
            'note':'Click a day to record leave',
            'addTitle':'Record leave', 'employee':'Employee', 'from':'From', 'to':'To',
            'kind':'Leave type', 'deduct':'Unpaid (deducted)', 'free':'Paid (no deduction)',
            'noteField':'Note', 'save':'Save', 'cancel':'Cancel',
            'errEmp':'Please choose an employee', 'errRange':'The end date cannot be before the start date',
            'delConfirm':'Delete this leave record?', 'days':'day(s)', 'noEmp':'No employees yet',
            'deductHint':'Deduction = base salary ÷ 30 × days of leave (applied on the Payroll page)',
            'periodClosed':'That month\'s payroll is authorized — unauthorize it before changing leave' }
    });

    function draw(container){
      if(!curDate){ const t = new Date(); curDate = new Date(t.getFullYear(), t.getMonth(), 1); }
      const en = isEn();
      const label = window.monthLabel(window.monthKeyOf(curDate));   // shared helper — any year
      const todayIso = new Date().toISOString().slice(0,10);
      const wk = (en?WEEKDAYS_EN:WEEKDAYS_TH).map(w=> `<span>${esc(w)}</span>`).join('');
      container.innerHTML = `
        <div class="topbar">
          <h1>${esc(T('title'))}</h1>
          <div class="crumb">${esc(T('crumb'))}</div>
        </div>
        <div class="content">
          <div class="panel">
            <div class="cal-toolbar">
              <button class="btn btn-ghost" id="ecPrev">\u2039</button>
              <span class="cal-label" id="ecLabel">${esc(label)}</span>
              <button class="btn btn-ghost" id="ecNext">\u203A</button>
              <button class="btn btn-ghost" id="ecToday">${esc(T('today'))}</button>
              <span class="del-cal-unsched">${esc(T('note'))}</span>
            </div>
            <div class="calendar-weekdays">${wk}</div>
            <div class="calendar-grid" id="ecGrid">
              ${monthMatrix(curDate).map(cell=> cell
                ? `<div class="cal-cell lv-cell ${cell.iso===todayIso?'today':''}" data-iso="${cell.iso}"><div class="cal-daynum">${cell.day}</div><div class="cal-cell-chips">${
                    leaves.filter(lv=> covers(lv, cell.iso)).map(lv=>
                      `<span class="lv-chip ${lv.kind==='deduct'?'is-deduct':'is-free'}" data-lv="${esc(lv.id)}" title="${esc((lv.empName||'') + ' · ' + T(lv.kind==='deduct'?'deduct':'free'))}">${esc(lv.empName||'-')}</span>`
                    ).join('')}</div></div>`
                : `<div class="cal-cell empty"></div>`).join('')}
            </div>
          </div>
        </div>`;
      container.querySelector('#ecPrev').addEventListener('click', ()=>{ curDate = new Date(curDate.getFullYear(), curDate.getMonth()-1, 1); draw(container); });
      container.querySelector('#ecNext').addEventListener('click', ()=>{ curDate = new Date(curDate.getFullYear(), curDate.getMonth()+1, 1); draw(container); });
      container.querySelector('#ecToday').addEventListener('click', ()=>{ const t = new Date(); curDate = new Date(t.getFullYear(), t.getMonth(), 1); draw(container); });
      container.querySelectorAll('.lv-cell').forEach(cell=> cell.addEventListener('click', (e)=>{
        const chip = e.target.closest('.lv-chip');
        if(chip){                                   // clicking a chip removes that record
          e.stopPropagation();
          const lv0 = leaves.find(x=> x.id === chip.dataset.lv);
          if(lv0 && typeof window.payrollPeriodClosed === 'function' && window.payrollPeriodClosed(String(lv0.from||'').slice(0,7))){
            alert(T('periodClosed')); return;
          }
          if(!window.confirm(T('delConfirm'))) return;
          leaves = leaves.filter(lv=> lv.id !== chip.dataset.lv);
          saveLeaves().then(()=> draw(container));
          return;
        }
        openLeaveModal(cell.dataset.iso, ()=> draw(container));
      }));
    }

    function openLeaveModal(dayIso, onDone){
      const staff = (typeof window.employeesAll === 'function' ? window.employeesAll() : [])
        .filter(e=> e.active !== false);
      let kind = 'deduct';
      const ov = document.createElement('div');
      ov.className = 'art-modal-overlay show';
      ov.innerHTML = `<div class="art-modal" style="max-width:480px;">
        <h3 class="art-modal-title">${esc(T('addTitle'))}</h3>
        ${staff.length ? `
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('employee'))}
            <select id="lvEmp">${staff.map(e=> `<option value="${esc(e.id)}">${esc(((e.name||'')+' '+(e.surname||'')).trim() || e.username || '-')}</option>`).join('')}</select>
          </label>
          <label>${esc(T('from'))}<input type="date" id="lvFrom" value="${esc(dayIso)}"></label>
          <label>${esc(T('to'))}<input type="date" id="lvTo" value="${esc(dayIso)}"></label>
        </div>
        <div class="art-img-label" style="margin:12px 0 6px;">${esc(T('kind'))}</div>
        <div class="del-seg" id="lvKind">
          <button type="button" class="del-seg-btn active" data-k="deduct">${esc(T('deduct'))}</button>
          <button type="button" class="del-seg-btn" data-k="free">${esc(T('free'))}</button>
        </div>
        <p class="setting-desc" id="lvHint">${esc(T('deductHint'))}</p>
        <label class="art-form-full">${esc(T('noteField'))}<input type="text" id="lvNote"></label>
        ` : `<p class="setting-desc">${esc(T('noEmp'))}</p>`}
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="lvCancel">${esc(T('cancel'))}</button>
          ${staff.length ? `<button class="btn btn-primary" id="lvSave">${esc(T('save'))}</button>` : ''}
        </div>
      </div>`;
      document.body.appendChild(ov);
      const close = ()=> ov.remove();
      ov.addEventListener('click', e=>{ if(e.target === ov) close(); });
      ov.querySelector('#lvCancel').addEventListener('click', close);
      if(!staff.length) return;
      ov.querySelectorAll('#lvKind [data-k]').forEach(b=> b.addEventListener('click', ()=>{
        kind = b.dataset.k;
        ov.querySelectorAll('#lvKind [data-k]').forEach(x=> x.classList.toggle('active', x.dataset.k === kind));
        ov.querySelector('#lvHint').style.display = (kind === 'deduct') ? '' : 'none';
      }));
      ov.querySelector('#lvSave').addEventListener('click', async ()=>{
        const empId = ov.querySelector('#lvEmp').value;
        const from = ov.querySelector('#lvFrom').value || dayIso;
        const to = ov.querySelector('#lvTo').value || from;
        if(!empId){ alert(T('errEmp')); return; }
        if(to < from){ alert(T('errRange')); return; }
        // Payroll for that month may already be signed off.
        if(typeof window.payrollPeriodClosed === 'function' && window.payrollPeriodClosed(from.slice(0,7))){
          alert(T('periodClosed')); return;
        }
        const emp = staff.find(e=> e.id === empId) || {};
        leaves.push({
          id: Math.random().toString(36).slice(2,10),
          empId, empName: ((emp.name||'')+' '+(emp.surname||'')).trim() || emp.username || '-',
          from, to, kind,
          note: ov.querySelector('#lvNote').value.trim(),
          createdAt: new Date().toISOString()
        });
        await saveLeaves();
        close();
        if(typeof onDone === 'function') onDone();
      });
    }

    window.registerModule({
      id: ID,
      navLabel: { th:'ปฏิทินพนักงาน', en:'Employee Calendar' },
      pageId: 'page-empCalendar',
      async onInit(){ leaves = await window.Store.list(K_LEAVE); },
      mount(container){ draw(container); },
      render(){ const c = document.getElementById('page-empCalendar'); if(c) draw(c); }
    });
  })();
})();
