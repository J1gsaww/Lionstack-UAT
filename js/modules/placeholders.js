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

  const MONTHS_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
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

  makeStubModule({
    id: 'timeLeave',
    title: { th:'เวลา & การลา', en:'Time / Leave' },
    crumb: { th:'เวลาเข้างานและวันลาของพนักงาน', en:'Attendance and leave' }
  });
  makeStubModule({
    id: 'benefit',
    title: { th:'สวัสดิการ', en:'Benefit' },
    crumb: { th:'สวัสดิการพนักงาน', en:'Employee benefits' }
  });

  /* ---------------- Employee Calendar: a real, empty month grid ------------ */
  (function(){
    const ID = 'empCalendar';
    const T = (k)=> window.moduleI18n(ID)(k);
    let curDate = null;

    window.registerModuleI18n(ID, {
      th: { 'title':'ปฏิทินพนักงาน', 'crumb':'ตารางงาน/วันลาของทีม', 'today':'วันนี้',
            'note':'ปฏิทินเปล่าไว้ก่อน — ยังไม่มีข้อมูลลงในนี้' },
      en: { 'title':'Employee Calendar', 'crumb':'Team schedule and leave', 'today':'Today',
            'note':'Empty for now — nothing is plotted on it yet' }
    });

    function draw(container){
      if(!curDate){ const t = new Date(); curDate = new Date(t.getFullYear(), t.getMonth(), 1); }
      const en = isEn();
      const label = (en?MONTHS_EN:MONTHS_TH)[curDate.getMonth()] + ' ' + curDate.getFullYear();
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
                ? `<div class="cal-cell ${cell.iso===todayIso?'today':''}" data-iso="${cell.iso}"><div class="cal-daynum">${cell.day}</div><div class="cal-cell-chips"></div></div>`
                : `<div class="cal-cell empty"></div>`).join('')}
            </div>
          </div>
        </div>`;
      container.querySelector('#ecPrev').addEventListener('click', ()=>{ curDate = new Date(curDate.getFullYear(), curDate.getMonth()-1, 1); draw(container); });
      container.querySelector('#ecNext').addEventListener('click', ()=>{ curDate = new Date(curDate.getFullYear(), curDate.getMonth()+1, 1); draw(container); });
      container.querySelector('#ecToday').addEventListener('click', ()=>{ const t = new Date(); curDate = new Date(t.getFullYear(), t.getMonth(), 1); draw(container); });
    }

    window.registerModule({
      id: ID,
      navLabel: { th:'ปฏิทินพนักงาน', en:'Employee Calendar' },
      pageId: 'page-empCalendar',
      async onInit(){},
      mount(container){ draw(container); },
      render(){ const c = document.getElementById('page-empCalendar'); if(c) draw(c); }
    });
  })();
})();
