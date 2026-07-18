/* ============================================================================
 * To-Do List — the owner's private planning board.
 *
 * LOCAL ONLY: this module talks to localStorage directly instead of window.Store,
 * so nothing here is ever synced to Firebase. It is a scratchpad for the person
 * running the shop, not business data.
 *
 * Subpages:
 *   todoList     — things to build / calculate (seeded with the fuel-cost task)
 *   todoPriority — the recommended order of work
 *   todoNeeds    — "Need More Requirement": decisions still to be made
 * ==========================================================================*/
(function(){
  const ID = 'todo';
  const KEYS = { todoList:'mod_todo_list', todoPriority:'mod_todo_priority', todoNeeds:'mod_todo_needs' };
  const SUBPAGES = ['todoList', 'todoPriority', 'todoNeeds'];

  const esc = (v)=> String(v==null?'':v).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rid = ()=> Math.random().toString(36).slice(2, 10);
  const T = (k)=> window.moduleI18n(ID)(k);

  let subPage = 'todoList';
  let lists = { todoList: null, todoPriority: null, todoNeeds: null };

  // ---- storage (localStorage only) ----
  function load(key){
    try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch(e){ return null; }
  }
  function save(key, arr){
    try{ localStorage.setItem(key, JSON.stringify(arr)); }
    catch(e){ /* quota — the board is not critical data */ }
  }
  const mk = (text, note)=> ({ id: rid(), text, note: note || '', done:false, createdAt: new Date().toISOString() });

  // Seeds: everything the user asked to park here, written once on first run.
  function seedFor(key){
    if(key === 'mod_todo_list') return [
      mk('การคำนวณค่าน้ำมันรถ (ต้นทุนจัดส่งต่อบิล)', 'กำไรต่อบิลใน Ledger ยังไม่รวมค่าน้ำมัน/ค่าจัดส่งจริง'),
      mk('ค่าธรรมเนียมแพลตฟอร์ม (Shopee / TikTok ฯลฯ)', 'ยอดขายบันทึกราคาเต็ม แต่เงินเข้าจริงถูกหัก 5-10%'),
      mk('รายงานภาษีขาย', 'รายงานรายเดือนสำหรับยื่น'),
      mk('มัดจำ / จ่ายบางส่วน', 'ตอนนี้มีแค่สถานะ จ่าย/ไม่จ่าย'),
      mk('แยกเงินส่วนตัวกับเงินกิจการ', 'ธุรกิจครอบครัวมักปนกัน — ควรมี tag เงินเจ้าของนำเข้า/ถอนออก')
    ];
    if(key === 'mod_todo_priority') return [
      mk('1. COGS + กำไรขั้นต้น', 'ข้อมูลมีครบแล้วใน costAllocation — คุ้มที่สุดต่อแรงที่ลง'),
      mk('2. ตัดสินใจเรื่อง VAT ให้ชัด', 'จด/ไม่จด แล้วออกแบบให้ตรงกรณีเดียว'),
      mk('3. หน้าลูกหนี้ (บิลค้างชำระ + อายุหนี้)', 'ของที่หายไปตอนบัญชีนับเฉพาะ Paid'),
      mk('4. Backup / ย้าย Firebase + เตือนพื้นที่ใกล้เต็ม', 'localStorage เต็มแล้วเซฟไม่ลงโดยไม่มีใครรู้'),
      mk('5. ล็อกบิลที่ Verified + ปิดงวดรายเดือน', 'กันแก้ย้อนหลังหลังยื่น/ปิดเดือน')
    ];
    if(key === 'mod_todo_needs') return [
      mk('บิลที่ Verified แล้ว = แก้ไม่ได้', 'ตอนนี้ Verified เป็นแค่ป้าย ยังแก้จากหน้า Sell ได้'),
      mk('เครื่องมือกระทบยอด', 'เช็ค: บิล Paid ที่ไม่ได้ระบุ lot ต้นทุน / ผลรวม lot ≠ สต๊อกที่แสดง')
    ];
    return [];
  }
  function listOf(sp){
    if(!lists[sp]){
      const key = KEYS[sp];
      let arr = load(key);
      if(!arr){ arr = seedFor(key); save(key, arr); }
      lists[sp] = arr;
    }
    return lists[sp];
  }
  function persist(sp){ save(KEYS[sp], lists[sp] || []); }

  // ---- rendering ----
  function drawSubnav(container){
    const nav = container.querySelector('#todoSubnav');
    if(!nav) return;
    nav.innerHTML = SUBPAGES.map(sp=>
      `<button type="button" class="acc-subnav-btn ${sp===subPage?'active':''}" data-subpage="${sp}">${esc(T('sub.'+sp))}</button>`
    ).join('');
  }

  function drawBody(container){
    const body = container.querySelector('#todoBody');
    if(!body) return;
    const items = listOf(subPage);
    const doneCount = items.filter(i=> i.done).length;
    body.innerHTML = `
      <div class="panel">
        <p class="setting-desc" style="margin-top:0;">${esc(T('desc.'+subPage))}</p>
        <div class="todo-add">
          <input type="text" id="todoNew" placeholder="${esc(T('addPh'))}">
          <button class="btn btn-primary" id="todoAdd">${esc(T('add'))}</button>
        </div>
        <div class="todo-count">${doneCount} / ${items.length} ${esc(T('done'))}</div>
        <div class="todo-list">
          ${items.length ? items.map((it,i)=> `
            <div class="todo-item ${it.done?'is-done':''}" data-i="${i}">
              <label class="todo-check"><input type="checkbox" ${it.done?'checked':''}></label>
              <div class="todo-main">
                <div class="todo-text" contenteditable="true" spellcheck="false">${esc(it.text)}</div>
                ${it.note ? `<div class="todo-note">${esc(it.note)}</div>` : ''}
              </div>
              <button class="acc-icon todo-del" title="${esc(T('delete'))}">\u2715</button>
            </div>`).join('') : `<p class="art-set-empty">${esc(T('empty'))}</p>`}
        </div>
      </div>`;

    const addItem = ()=>{
      const inp = body.querySelector('#todoNew');
      const txt = (inp.value || '').trim();
      if(!txt) return;
      listOf(subPage).unshift(mk(txt));
      persist(subPage);
      drawBody(container);
    };
    body.querySelector('#todoAdd').addEventListener('click', addItem);
    body.querySelector('#todoNew').addEventListener('keydown', (e)=>{ if(e.key === 'Enter') addItem(); });

    body.querySelectorAll('.todo-item').forEach(row=>{
      const i = parseInt(row.dataset.i, 10);
      row.querySelector('.todo-check input').addEventListener('change', (e)=>{
        listOf(subPage)[i].done = e.target.checked;
        persist(subPage);
        drawBody(container);
      });
      row.querySelector('.todo-del').addEventListener('click', ()=>{
        if(!window.confirm(T('delConfirm'))) return;
        listOf(subPage).splice(i, 1);
        persist(subPage);
        drawBody(container);
      });
      // Inline editing: save on blur so typing is never interrupted by a redraw.
      row.querySelector('.todo-text').addEventListener('blur', (e)=>{
        const v = (e.target.textContent || '').trim();
        if(!v){ drawBody(container); return; }
        listOf(subPage)[i].text = v;
        persist(subPage);
      });
    });
  }

  window.registerModuleI18n(ID, {
    th: {
      'title': 'สิ่งที่ต้องทำ', 'crumb': 'บันทึกส่วนตัว (เก็บในเครื่องนี้เท่านั้น)',
      'sub.todoList': 'สิ่งที่ต้องทำ', 'sub.todoPriority': 'ลำดับความสำคัญ', 'sub.todoNeeds': 'ต้องการรายละเอียดเพิ่ม',
      'desc.todoList': 'งานที่ยังไม่ได้ทำในระบบ — เพิ่ม/ติ๊ก/แก้ข้อความได้ กดที่ข้อความเพื่อแก้',
      'desc.todoPriority': 'ลำดับที่แนะนำให้ทำก่อนหลัง',
      'desc.todoNeeds': 'เรื่องที่ต้องเคาะรายละเอียดก่อนถึงจะลงมือได้',
      'add': 'เพิ่ม', 'addPh': 'พิมพ์สิ่งที่ต้องทำ แล้วกด Enter', 'done': 'เสร็จแล้ว',
      'empty': 'ยังไม่มีรายการ', 'delete': 'ลบ', 'delConfirm': 'ลบรายการนี้?'
    },
    en: {
      'title': 'To-Do List', 'crumb': 'Private notes (stored on this device only)',
      'sub.todoList': 'To-Do', 'sub.todoPriority': 'Priority', 'sub.todoNeeds': 'Need More Requirement',
      'desc.todoList': 'Work not built yet — add, tick or edit. Click the text to edit it.',
      'desc.todoPriority': 'Suggested order of work',
      'desc.todoNeeds': 'Decisions that need pinning down before they can be built',
      'add': 'Add', 'addPh': 'Type something to do, then press Enter', 'done': 'done',
      'empty': 'Nothing here yet', 'delete': 'Delete', 'delConfirm': 'Delete this item?'
    }
  });

  window.registerModule({
    id: ID,
    navLabel: { th: 'สิ่งที่ต้องทำ', en: 'To-Do List' },
    pageId: 'page-todo',
    async onInit(){ /* nothing to preload — localStorage is read lazily */ },
    mount(container){
      container.innerHTML = `
        <div class="topbar">
          <h1>${esc(T('title'))}</h1>
          <div class="crumb">${esc(T('crumb'))}</div>
        </div>
        <div class="content">
          <div class="acc-subnav store-subnav" id="todoSubnav"></div>
          <div id="todoBody"></div>
        </div>`;
      container.querySelector('#todoSubnav').addEventListener('click', (e)=>{
        const btn = e.target.closest('[data-subpage]');
        if(!btn) return;
        subPage = btn.dataset.subpage;
        this.render();
      });
      this.render();
    },
    render(){
      const container = document.getElementById('page-todo');
      if(!container) return;
      const h1 = container.querySelector('.topbar h1');
      if(h1) h1.textContent = T('title');
      const crumb = container.querySelector('.crumb');
      if(crumb) crumb.textContent = T('crumb');
      drawSubnav(container);
      drawBody(container);
    }
  });
})();
