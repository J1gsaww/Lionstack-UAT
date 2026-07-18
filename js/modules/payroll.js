/* ============================================================================
 * Payroll — sits under Accounting.
 *
 * Scaffolding only for now: nothing here CALCULATES a payslip yet. It stores the
 * building blocks so the maths can be added later without moving data around.
 *
 * Subpages:
 *   empPayroll  — roster with each employee's base salary; click a row to edit
 *   compensation — the pay components (earnings / deductions) used by payroll
 *   processPayroll — deliberately empty until the run logic is designed
 *
 * The employee roster is NOT owned here: it is read through window.employeesAll()
 * and written through window.employeeUpdate() so employees.js stays the single
 * writer of mod_emp_employees.
 * ==========================================================================*/
(function(){
  const ID = 'payroll';
  const K_COMP = 'mod_payroll_components';   // [{ id, code, name, mode, pfss, tax, taxType }]
  const SUBPAGES = ['empPayroll', 'compensation', 'processPayroll'];

  const esc = (v)=> String(v==null?'':v).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rid = ()=> 'pc_' + Math.random().toString(36).slice(2, 9);
  const T = (k)=> window.moduleI18n(ID)(k);
  const fmt = (n)=> Number(n||0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });

  let subPage = 'empPayroll';
  let components = [];
  let compMode = 'earn';      // which side of the Compensation switch is showing
  let editingEmpId = null;    // employee being edited on the payroll page

  async function loadAll(){ components = await window.Store.list(K_COMP); }
  async function saveComponents(){ await window.Store.set(K_COMP, components); }
  const roster = ()=> (typeof window.employeesAll === 'function' ? window.employeesAll() : []);

  // Codes run per side: earn01, earn02 … / deduct01, deduct02 …
  function nextCode(mode){
    const prefix = mode === 'deduct' ? 'deduct' : 'earn';
    let n = 0;
    components.filter(c=> c.mode === mode).forEach(c=>{
      const m = String(c.code||'').match(new RegExp('^' + prefix + '(\\d+)$'));
      if(m) n = Math.max(n, parseInt(m[1], 10));
    });
    return prefix + String(n + 1).padStart(2, '0');
  }

  /* ---------------- Employee Payroll ---------------- */
  function drawEmpPayroll(body){
    const list = roster();
    if(editingEmpId){ drawEmpPayrollDetail(body, editingEmpId); return; }
    body.innerHTML = `
      <div class="panel">
        <p class="setting-desc" style="margin-top:0;">${esc(T('pay.listDesc'))}</p>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th>${esc(T('pay.empId'))}</th><th>${esc(T('pay.name'))}</th><th>${esc(T('pay.role'))}</th>
              <th class="num">${esc(T('pay.baseSalary'))}</th><th></th>
            </tr></thead>
            <tbody>${list.length ? list.map(e=> `
              <tr class="pay-row" data-id="${esc(e.id)}">
                <td class="art-id">${esc(e.employeeId||'-')}</td>
                <td>${esc(((e.name||'') + ' ' + (e.surname||'')).trim() || e.username || '-')}</td>
                <td>${esc(e.roleKey||'-')}</td>
                <td class="num">${fmt(e.baseSalary)}</td>
                <td><button class="acc-icon pay-edit" title="${esc(T('common.edit'))}">\u270E</button></td>
              </tr>`).join('') : `<tr><td colspan="5" class="art-empty">${esc(T('pay.noEmp'))}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    body.querySelectorAll('.pay-row').forEach(tr=>{
      const open = ()=>{ editingEmpId = tr.dataset.id; drawEmpPayroll(body); };
      tr.addEventListener('click', open);
    });
  }

  function drawEmpPayrollDetail(body, id){
    const emp = roster().find(e=> e.id === id);
    if(!emp){ editingEmpId = null; drawEmpPayroll(body); return; }
    const fullName = ((emp.name||'') + ' ' + (emp.surname||'')).trim() || emp.username || '-';
    const earns = components.filter(c=> c.mode === 'earn');
    const deducts = components.filter(c=> c.mode === 'deduct');
    const lineRows = (arr)=> arr.length
      ? arr.map(c=> `<div class="pay-line"><span class="pay-line-code">${esc(c.code)}</span><span class="pay-line-name">${esc(c.name)}</span><span class="pay-line-val">\u2014</span></div>`).join('')
      : `<p class="art-set-empty">${esc(T('pay.noComp'))}</p>`;
    body.innerHTML = `
      <div class="panel">
        <div class="art-order-form-head">
          <button type="button" class="btn btn-ghost" id="payBack">\u2190 ${esc(T('common.back'))}</button>
          <h3 class="art-modal-title">${esc(fullName)}</h3>
        </div>
        <div class="art-form-grid">
          <label>${esc(T('pay.empId'))}<input type="text" value="${esc(emp.employeeId||'')}" disabled></label>
          <label>${esc(T('pay.baseSalary'))}<input type="number" id="payBase" step="0.01" min="0" value="${esc(emp.baseSalary != null ? emp.baseSalary : 0)}"></label>
        </div>
        <h4 class="art-form-section">${esc(T('pay.earnings'))}</h4>
        <div class="pay-lines">${lineRows(earns)}</div>
        <h4 class="art-form-section">${esc(T('pay.deductions'))}</h4>
        <div class="pay-lines">${lineRows(deducts)}</div>
        <p class="setting-desc">${esc(T('pay.detailNote'))}</p>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="payCancel">${esc(T('common.cancel'))}</button>
          <button class="btn btn-primary" id="paySave">${esc(T('common.save'))}</button>
        </div>
      </div>`;
    const close = ()=>{ editingEmpId = null; drawEmpPayroll(body); };
    body.querySelector('#payBack').addEventListener('click', close);
    body.querySelector('#payCancel').addEventListener('click', close);
    body.querySelector('#paySave').addEventListener('click', async ()=>{
      const val = parseFloat(body.querySelector('#payBase').value) || 0;
      if(typeof window.employeeUpdate === 'function') await window.employeeUpdate(id, { baseSalary: val });
      close();
    });
  }

  /* ---------------- Compensation ---------------- */
  function drawCompensation(body){
    const list = components.filter(c=> c.mode === compMode);
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="del-seg" id="compSeg">
            <button type="button" class="del-seg-btn ${compMode==='earn'?'active':''}" data-mode="earn">${esc(T('comp.earn'))}</button>
            <button type="button" class="del-seg-btn ${compMode==='deduct'?'active':''}" data-mode="deduct">${esc(T('comp.deduct'))}</button>
          </div>
          <div class="art-spacer"></div>
          <button class="btn btn-primary" id="compAdd">${esc(T('comp.add'))}</button>
        </div>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th>${esc(T('comp.code'))}</th><th>${esc(T('comp.name'))}</th><th>${esc(T('comp.mode'))}</th>
              <th class="c">${esc(T('comp.pfss'))}</th><th class="c">${esc(T('comp.tax'))}</th><th></th>
            </tr></thead>
            <tbody>${list.length ? list.map(c=> `
              <tr data-id="${esc(c.id)}">
                <td class="art-id">${esc(c.code)}</td>
                <td>${esc(c.name)}</td>
                <td><span class="art-pill" style="background:${c.mode==='earn'?'#6B8F71':'#C6432E'}">${esc(c.mode==='earn'?T('comp.earn'):T('comp.deduct'))}</span></td>
                <td class="c">${c.pfss ? '\u2713' : '\u2014'}</td>
                <td class="c">${c.tax ? esc(c.taxType || '40(1)') : '\u2014'}</td>
                <td><div class="art-row-actions">
                  <button class="acc-icon comp-edit" title="${esc(T('common.edit'))}">\u270E</button>
                  <button class="acc-icon comp-del" title="${esc(T('common.delete'))}">\u2715</button>
                </div></td>
              </tr>`).join('') : `<tr><td colspan="6" class="art-empty">${esc(T('comp.empty'))}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    body.querySelectorAll('#compSeg [data-mode]').forEach(b=> b.addEventListener('click', ()=>{ compMode = b.dataset.mode; drawCompensation(body); }));
    body.querySelector('#compAdd').addEventListener('click', ()=> openCompEditor(body, null));
    body.querySelectorAll('tr[data-id]').forEach(tr=>{
      const id = tr.dataset.id;
      tr.querySelector('.comp-edit').addEventListener('click', ()=> openCompEditor(body, id));
      tr.querySelector('.comp-del').addEventListener('click', async ()=>{
        if(!window.confirm(T('comp.delConfirm'))) return;
        components = components.filter(c=> c.id !== id);
        await saveComponents();
        drawCompensation(body);
      });
    });
  }

  function openCompEditor(body, id){
    const rec = id ? components.find(c=> c.id === id) : null;
    const mode = rec ? rec.mode : compMode;
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal">
        <h3 class="art-modal-title">${esc(rec ? T('comp.editTitle') : T('comp.addTitle'))}</h3>
        <div class="art-form-grid">
          <label>${esc(T('comp.code'))}<input type="text" id="cCode" value="${esc(rec ? rec.code : nextCode(mode))}"></label>
          <label>${esc(T('comp.name'))}<input type="text" id="cName" value="${esc(rec ? rec.name : '')}" placeholder="${esc(T('comp.namePh'))}"></label>
        </div>
        <label class="art-img-label" style="display:block; margin:12px 0 6px;">${esc(T('comp.mode'))}</label>
        <div class="del-seg" id="cMode">
          <button type="button" class="del-seg-btn ${mode==='earn'?'active':''}" data-m="earn">${esc(T('comp.earn'))}</button>
          <button type="button" class="del-seg-btn ${mode==='deduct'?'active':''}" data-m="deduct">${esc(T('comp.deduct'))}</button>
        </div>
        <h4 class="art-form-section">${esc(T('comp.rules'))}</h4>
        <label class="pc-switch"><input type="checkbox" id="cPfss" ${rec && rec.pfss ? 'checked' : ''}><span>${esc(T('comp.pfssFull'))}</span></label>
        <label class="pc-switch" style="display:flex;"><input type="checkbox" id="cTax" ${rec && rec.tax ? 'checked' : ''}><span>${esc(T('comp.taxFull'))}</span></label>
        <div class="del-seg" id="cTaxType" style="margin-top:8px; ${rec && rec.tax ? '' : 'display:none;'}">
          <button type="button" class="del-seg-btn ${!rec || rec.taxType!=='40(2)' ? 'active':''}" data-tt="40(1)">40(1)</button>
          <button type="button" class="del-seg-btn ${rec && rec.taxType==='40(2)' ? 'active':''}" data-tt="40(2)">40(2)</button>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="cCancel">${esc(T('common.cancel'))}</button>
          <button class="btn btn-primary" id="cSave">${esc(T('common.save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const g = (x)=> ov.querySelector('#'+x);
    let curMode = mode;
    let curTaxType = rec && rec.taxType ? rec.taxType : '40(1)';
    ov.querySelectorAll('#cMode [data-m]').forEach(b=> b.addEventListener('click', ()=>{
      curMode = b.dataset.m;
      ov.querySelectorAll('#cMode [data-m]').forEach(x=> x.classList.toggle('active', x.dataset.m === curMode));
      if(!rec) g('cCode').value = nextCode(curMode);
    }));
    ov.querySelectorAll('#cTaxType [data-tt]').forEach(b=> b.addEventListener('click', ()=>{
      curTaxType = b.dataset.tt;
      ov.querySelectorAll('#cTaxType [data-tt]').forEach(x=> x.classList.toggle('active', x.dataset.tt === curTaxType));
    }));
    g('cTax').addEventListener('change', (e)=>{ g('cTaxType').style.display = e.target.checked ? '' : 'none'; });
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target === ov) close(); });
    g('cCancel').addEventListener('click', close);
    g('cSave').addEventListener('click', async ()=>{
      const code = g('cCode').value.trim();
      const name = g('cName').value.trim();
      if(!code){ alert(T('comp.errCode')); return; }
      if(!name){ alert(T('comp.errName')); return; }
      const data = { code, name, mode: curMode, pfss: g('cPfss').checked, tax: g('cTax').checked, taxType: g('cTax').checked ? curTaxType : '' };
      if(rec) Object.assign(rec, data);
      else components.push({ id: rid(), ...data });
      await saveComponents();
      compMode = curMode;
      close();
      drawCompensation(body);
    });
  }

  /* ---------------- Process Payroll (placeholder) ---------------- */
  function drawProcess(body){
    body.innerHTML = `
      <div class="panel">
        <div class="art-empty" style="padding:48px 20px;">
          <div class="art-empty-ico">\u{1F6A7}</div>
          <div>${esc(T('proc.soon'))}</div>
        </div>
      </div>`;
  }

  /* ---------------- shell ---------------- */
  function drawSubnav(container){
    const nav = container.querySelector('#payrollSubnav');
    if(!nav) return;
    nav.innerHTML = SUBPAGES.map(sp=>
      `<button type="button" class="acc-subnav-btn ${sp===subPage?'active':''}" data-subpage="${sp}">${esc(T('sub.'+sp))}</button>`
    ).join('');
  }

  window.registerModuleI18n(ID, {
    th: {
      'title': 'เงินเดือน (Payroll)', 'crumb': 'ระบบจัดการค่าตอบแทนพนักงาน',
      'sub.empPayroll': 'เงินเดือนพนักงาน', 'sub.compensation': 'ค่าเงิน (Compensation)', 'sub.processPayroll': 'ประมวลผลเงินเดือน',
      'common.save': 'บันทึก', 'common.cancel': 'ยกเลิก', 'common.edit': 'แก้ไข', 'common.delete': 'ลบ', 'common.back': 'กลับ',
      'pay.listDesc': 'รายชื่อพนักงานทั้งหมด กดที่แถวเพื่อเข้าไปแก้ไขข้อมูลเงินเดือน',
      'pay.empId': 'รหัสพนักงาน', 'pay.name': 'ชื่อ-นามสกุล', 'pay.role': 'บทบาท', 'pay.baseSalary': 'เงินเดือนพื้นฐาน',
      'pay.noEmp': 'ยังไม่มีพนักงาน', 'pay.earnings': 'รายการเพิ่ม (Earn)', 'pay.deductions': 'รายการหัก (Deduct)',
      'pay.noComp': 'ยังไม่ได้สร้างค่าเงินในหมวดนี้',
      'pay.detailNote': 'ตอนนี้ยังไม่คำนวณจริง — ช่องค่าเงินเตรียมไว้รอสูตรคำนวณ',
      'comp.earn': 'Earn (เพิ่ม)', 'comp.deduct': 'Deduct (หัก)', 'comp.add': '+ เพิ่มค่าเงิน',
      'comp.code': 'โค้ด', 'comp.name': 'ชื่อค่าเงิน', 'comp.namePh': 'เช่น ค่าล่วงเวลา, ค่าน้ำมัน',
      'comp.mode': 'ประเภท', 'comp.pfss': 'PF/SS', 'comp.tax': 'ภาษี',
      'comp.pfssFull': 'คิด PF / ประกันสังคม (SS)', 'comp.taxFull': 'คิดภาษี',
      'comp.rules': 'เงื่อนไขการคำนวณ', 'comp.empty': 'ยังไม่มีค่าเงินในหมวดนี้',
      'comp.addTitle': 'เพิ่มค่าเงิน', 'comp.editTitle': 'แก้ไขค่าเงิน', 'comp.delConfirm': 'ลบค่าเงินนี้?',
      'comp.errCode': 'กรุณาใส่โค้ด', 'comp.errName': 'กรุณาใส่ชื่อค่าเงิน',
      'proc.soon': 'ยังไม่เปิดใช้งาน — รอออกแบบรอบการจ่ายเงินเดือน'
    },
    en: {
      'title': 'Payroll', 'crumb': 'Employee compensation',
      'sub.empPayroll': 'Employee Payroll', 'sub.compensation': 'Compensation', 'sub.processPayroll': 'Process Payroll',
      'common.save': 'Save', 'common.cancel': 'Cancel', 'common.edit': 'Edit', 'common.delete': 'Delete', 'common.back': 'Back',
      'pay.listDesc': 'Everyone on the roster — click a row to edit their payroll',
      'pay.empId': 'Employee ID', 'pay.name': 'Name', 'pay.role': 'Role', 'pay.baseSalary': 'Base salary',
      'pay.noEmp': 'No employees yet', 'pay.earnings': 'Earnings', 'pay.deductions': 'Deductions',
      'pay.noComp': 'No components created on this side yet',
      'pay.detailNote': 'Nothing is calculated yet — these lines are placeholders for the payroll formula',
      'comp.earn': 'Earn', 'comp.deduct': 'Deduct', 'comp.add': '+ Add component',
      'comp.code': 'Code', 'comp.name': 'Name', 'comp.namePh': 'e.g. Overtime, Fuel allowance',
      'comp.mode': 'Type', 'comp.pfss': 'PF/SS', 'comp.tax': 'Tax',
      'comp.pfssFull': 'Counts toward PF / Social Security', 'comp.taxFull': 'Taxable',
      'comp.rules': 'Calculation rules', 'comp.empty': 'Nothing on this side yet',
      'comp.addTitle': 'Add component', 'comp.editTitle': 'Edit component', 'comp.delConfirm': 'Delete this component?',
      'comp.errCode': 'Please enter a code', 'comp.errName': 'Please enter a name',
      'proc.soon': 'Not built yet — the payroll run still needs designing'
    }
  });

  window.registerModule({
    id: ID,
    navLabel: { th: 'เงินเดือน', en: 'Payroll' },
    pageId: 'page-payroll',
    async onInit(){ await loadAll(); },
    async mount(container){
      if(!components.length) await loadAll();
      container.innerHTML = `
        <div class="topbar">
          <h1>${esc(T('title'))}</h1>
          <div class="crumb">${esc(T('crumb'))}</div>
        </div>
        <div class="content">
          <div class="acc-subnav store-subnav" id="payrollSubnav"></div>
          <div id="payrollBody"></div>
        </div>`;
      container.querySelector('#payrollSubnav').addEventListener('click', (e)=>{
        const btn = e.target.closest('[data-subpage]');
        if(!btn) return;
        subPage = btn.dataset.subpage;
        editingEmpId = null;
        this.render();
      });
      this.render();
    },
    render(){
      const container = document.getElementById('page-payroll');
      if(!container) return;
      const h1 = container.querySelector('.topbar h1');
      if(h1) h1.textContent = T('title');
      const crumb = container.querySelector('.crumb');
      if(crumb) crumb.textContent = T('crumb');
      drawSubnav(container);
      const body = container.querySelector('#payrollBody');
      if(!body) return;
      if(subPage === 'compensation') drawCompensation(body);
      else if(subPage === 'processPayroll') drawProcess(body);
      else drawEmpPayroll(body);
    }
  });
})();
