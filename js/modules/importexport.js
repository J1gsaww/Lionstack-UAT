/* ============================================================================
 * Import / Export
 *
 * One subpage per app page so a restore can be scoped instead of being an
 * all-or-nothing gamble. Everything is driven by the GROUPS manifest: a page is
 * a list of SHEETS, and a sheet is a storage key. Adding a page means adding its
 * keys here — there is no per-page import/export code to keep in sync.
 *
 * Formats
 *   export : xlsx (one sheet per subpage) · csv (zipped when >1 sheet) · json
 *   import : xlsx and json only — csv is export-only on purpose, it cannot carry
 *            several sheets or the type information needed to rebuild records.
 *   overall: a zip of every page's xlsx + csv.
 *
 * xlsx rule: EVERY cell is written as text, and an import is rejected if any
 * cell in the workbook is not text (Excel silently turning "0812345678" into a
 * number is exactly the kind of corruption this guards against). Types are kept
 * in a `_meta` sheet so a text workbook can still be rebuilt losslessly.
 * ==========================================================================*/
(function(){
  const ID = 'importExport';

  const esc = (v)=> String(v==null?'':v).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const T = (k)=> window.moduleI18n(ID)(k);

  /* ---------------- manifest ---------------- */
  // kind 'rows' (default) = an array of records · kind 'kv' = one object blob
  const GROUPS = [
    { id:'ieOverall', sheets:null },
    { id:'ieStock', sheets:[
      { name:'products',        key:'mod_store_products' },
      { name:'lots',            key:'mod_store_lots' },
      { name:'stockHistory',    key:'mod_store_stocklog' },
      { name:'productHistory',  key:'mod_store_productlog' },
      { name:'deletedProducts', key:'mod_store_deleted_products' },
      { name:'publicStock',     key:'mod_store_stockpublic', kind:'kv' }
    ]},
    { id:'ieSell', sheets:[
      { name:'orders',        key:'mod_store_orders' },
      { name:'orderHistory',  key:'mod_store_orderlog' },
      { name:'deletedOrders', key:'mod_store_deleted_orders' }
    ]},
    { id:'ieDelivery', sheets:[
      { name:'deliveries', key:'mod_store_deliveries' }
    ]},
    { id:'ieStorefront', sheets:[
      { name:'config',    key:'mod_storefront_config',    kind:'kv' },
      { name:'published', key:'mod_storefront_published', kind:'kv' }
    ]},
    { id:'ieRevenue',   sheets:[], reads:['ieSell'] },
    { id:'ieCogs',      sheets:[], reads:['ieSell','ieStock'] },
    { id:'ieExpense', sheets:[
      { name:'opExpense',     key:'mod_store_opex' },
      { name:'opexHistory',   key:'mod_store_opexlog' },
      { name:'stockExpenses', key:'mod_store_expenses' }
    ]},
    { id:'ieFinancial', sheets:[], reads:['ieSell','ieStock','ieExpense'] },
    { id:'iePayroll', sheets:[
      { name:'components',    key:'mod_payroll_components' },
      { name:'empComponents', key:'mod_payroll_empcomp', kind:'kv' },
      { name:'periods',       key:'mod_payroll_periods', kind:'kv' }
    ]},
    { id:'ieCalendar', sheets:[
      { name:'leave', key:'mod_hr_leave' }
    ]},
    { id:'ieEmployees', sheets:[
      { name:'employees', key:'mod_emp_employees' },
      { name:'roles',     key:'mod_emp_roles' },
      { name:'access',    key:'mod_emp_access', kind:'kv' }
    ]},
    { id:'ieSetting', sheets:[
      { name:'config',     key:'mod_store_config', kind:'kv' },
      { name:'promotions', key:'mod_store_promotions' }
    ]}
  ];
  const SUBPAGES = GROUPS.map(g=> g.id);
  const dataGroups = ()=> GROUPS.filter(g=> g.sheets && g.sheets.length);
  const groupOf = (id)=> GROUPS.find(g=> g.id === id) || GROUPS[0];
  function sheetsOf(id){
    const g = groupOf(id);
    if(g.sheets) return g.sheets;
    // Overall: every sheet of every page, prefixed so names stay unique.
    const out = [];
    dataGroups().forEach(x=> x.sheets.forEach(sh=> out.push({ ...sh, name: x.id.replace(/^ie/,'') + '_' + sh.name })));
    return out;
  }

  let subPage = SUBPAGES[0];

  /* ---------------- value <-> text ---------------- */
  const MAX_CELL = 32000;                 // Excel's own limit is 32767
  const OVERSIZE = '__OVERSIZE__';        // marker: value left in place on import
  const typeOf = (v)=>
    (v === null || v === undefined) ? 't'
    : (Array.isArray(v) || typeof v === 'object') ? 'j'
    : (typeof v === 'number') ? 'n'
    : (typeof v === 'boolean') ? 'b' : 't';
  const toText = (v, t)=>
    t === 'j' ? JSON.stringify(v === undefined ? null : v)
    : (v === null || v === undefined) ? '' : String(v);
  function fromText(s, t){
    const str = (s == null) ? '' : String(s);
    if(t === 'j') return str === '' ? null : JSON.parse(str);
    if(t === 'n') return str === '' ? 0 : Number(str);
    if(t === 'b') return str === 'true' || str === 'TRUE' || str === '1';
    return str;
  }

  /* ---------------- rows for one sheet ---------------- */
  // Returns { fields, types, rows } — rows are already text.
  // `cap` = true when the target is a spreadsheet: values too long for a cell are
  // replaced with a marker (and reported) instead of blowing the export up.
  function sheetRows(value, kind, cap){
    const oversize = [];
    const fit = (text, field)=>{
      if(cap && text && text.length > MAX_CELL){
        if(oversize.indexOf(field) < 0) oversize.push(field);
        return OVERSIZE;
      }
      return text;
    };
    if(kind === 'kv'){
      const obj = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
      const fields = ['field', 'value'];
      const types = { field:'t', value:'j' };
      const rows = Object.keys(obj).map(k=> [k, fit(toText(obj[k], 'j'), k)]);
      return { fields, types, rows, oversize };
    }
    const arr = Array.isArray(value) ? value : [];
    const fields = [];
    const types = {};
    arr.forEach(rec=>{
      if(!rec || typeof rec !== 'object') return;
      Object.keys(rec).forEach(f=>{
        if(fields.indexOf(f) < 0) fields.push(f);
        if(!types[f] || types[f] === 't'){
          const t = typeOf(rec[f]);
          if(t !== 't') types[f] = t;                 // first informative type wins
          else if(!types[f]) types[f] = 't';
        }
      });
    });
    const rows = arr.map(rec=> fields.map(f=> fit(toText(rec && rec[f], types[f] || 't'), f)));
    return { fields, types, rows, oversize };
  }
  function rowsToValue(fields, types, rows, kind, current){
    if(kind === 'kv'){
      const prev = (current && typeof current === 'object' && !Array.isArray(current)) ? current : {};
      const out = {};
      rows.forEach(r=>{
        const k = String(r[0] == null ? '' : r[0]);
        if(!k) return;
        out[k] = (String(r[1]) === OVERSIZE) ? prev[k] : fromText(r[1], 'j');
      });
      return out;
    }
    // Keep oversize fields by matching the existing record on id.
    const byId = {};
    (Array.isArray(current) ? current : []).forEach(rec=>{ if(rec && rec.id != null) byId[rec.id] = rec; });
    return rows.map(r=>{
      const rec = {};
      fields.forEach((f, i)=>{ rec[f] = (String(r[i]) === OVERSIZE) ? undefined : fromText(r[i], types[f] || 't'); });
      const old = (rec.id != null) ? byId[rec.id] : null;
      fields.forEach((f, i)=>{
        if(String(r[i]) !== OVERSIZE) return;
        rec[f] = old ? old[f] : null;              // nothing to restore from → null
      });
      return rec;
    });
  }

  /* ---------------- libraries, loaded only when used ---------------- */
  function loadScript(src){
    return new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = ()=> reject(new Error(src));
      document.head.appendChild(s);
    });
  }
  async function needXLSX(){
    if(!window.XLSX) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    if(!window.XLSX) throw new Error('xlsx');
    return window.XLSX;
  }
  async function needZip(){
    if(!window.JSZip) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    if(!window.JSZip) throw new Error('jszip');
    return window.JSZip;
  }
  async function needExcelJS(){
    if(!window.ExcelJS) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
    if(!window.ExcelJS) throw new Error('exceljs');
    return window.ExcelJS;
  }
  // Header style applied to EVERY exported sheet: fill #95B3D7 + bold font #244062.
  const HDR_FILL = 'FF95B3D7';
  const HDR_FONT = 'FF244062';
  function styleHeaderRow(ws){
    ws.getRow(1).eachCell({ includeEmpty:true }, (cell)=>{
      cell.font = { bold:true, color:{ argb:HDR_FONT } };
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:HDR_FILL } };
    });
  }

  /* ---------------- helpers ---------------- */
  async function readSheets(id){
    const out = [];
    for(const sh of sheetsOf(id)){
      out.push({ ...sh, value: await window.Store.get(sh.key) });
    }
    return out;
  }
  const countOf = (v)=> Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : (v == null ? 0 : 1));
  const stamp = ()=> new Date().toISOString().slice(0,10);
  const safeName = (n)=> String(n).replace(/[\[\]:*?\/\\]/g, '_').slice(0, 31);

  function download(name, blob){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  const fileBase = (id)=> 'lionstack-' + id.replace(/^ie/,'').toLowerCase() + '-' + stamp();

  function csvOf(fields, rows){
    const q = (v)=> '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    return [fields.map(q).join(',')].concat(rows.map(r=> r.map(q).join(','))).join('\r\n');
  }

  // Builds a workbook whose cells are ALL text, plus a _meta sheet of types.
  async function workbookOf(id){
    const XLSX = await needXLSX();
    const wb = XLSX.utils.book_new();
    const meta = [['sheet','field','type','key','kind']];
    const oversize = [];
    for(const sh of await readSheets(id)){
      const { fields, types, rows, oversize: big } = sheetRows(sh.value, sh.kind, true);
      (big || []).forEach(f=> oversize.push(sh.name + '.' + f));
      const aoa = [fields.length ? fields : ['(empty)']].concat(rows);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Force every cell to the string type — this is the whole point.
      Object.keys(ws).forEach(addr=>{
        if(addr[0] === '!') return;
        const cell = ws[addr];
        cell.t = 's';
        cell.v = (cell.v == null) ? '' : String(cell.v);
        delete cell.z; delete cell.f;
      });
      XLSX.utils.book_append_sheet(wb, ws, safeName(sh.name));
      (fields.length ? fields : []).forEach(f=> meta.push([sh.name, f, types[f] || 't', sh.key, sh.kind || 'rows']));
      if(!fields.length) meta.push([sh.name, '', '', sh.key, sh.kind || 'rows']);
    }
    const wsMeta = XLSX.utils.aoa_to_sheet(meta);
    Object.keys(wsMeta).forEach(addr=>{ if(addr[0] !== '!'){ wsMeta[addr].t = 's'; wsMeta[addr].v = String(wsMeta[addr].v == null ? '' : wsMeta[addr].v); } });
    XLSX.utils.book_append_sheet(wb, wsMeta, '_meta');
    return { XLSX, wb, oversize };
  }

  // Same data as workbookOf, but built with ExcelJS so the header row can carry a
  // fill + bold font. Every cell is still forced to text. Returns an ArrayBuffer.
  async function xlsxBufferOf(id){
    const ExcelJS = await needExcelJS();
    const wb = new ExcelJS.Workbook();
    const meta = [['sheet','field','type','key','kind']];
    const oversize = [];
    const forceText = (ws)=> ws.eachRow({ includeEmpty:false }, (row)=> row.eachCell({ includeEmpty:true }, (cell)=>{
      cell.numFmt = '@';
      if(cell.value != null) cell.value = String(cell.value);
    }));
    for(const sh of await readSheets(id)){
      const { fields, types, rows, oversize: big } = sheetRows(sh.value, sh.kind, true);
      (big || []).forEach(f=> oversize.push(sh.name + '.' + f));
      const ws = wb.addWorksheet(safeName(sh.name));
      ws.addRow(fields.length ? fields : ['(empty)']);
      rows.forEach(r=> ws.addRow(r.map(c=> (c == null ? '' : String(c)))));
      forceText(ws);
      styleHeaderRow(ws);
      (fields.length ? fields : []).forEach(f=> meta.push([sh.name, f, types[f] || 't', sh.key, sh.kind || 'rows']));
      if(!fields.length) meta.push([sh.name, '', '', sh.key, sh.kind || 'rows']);
    }
    const wsMeta = wb.addWorksheet('_meta');
    meta.forEach(r=> wsMeta.addRow(r.map(c=> (c == null ? '' : String(c)))));
    forceText(wsMeta);
    styleHeaderRow(wsMeta);
    const buffer = await wb.xlsx.writeBuffer();
    return { buffer, oversize };
  }

  /* ---------------- export ---------------- */
  async function exportJson(id){
    const sheets = await readSheets(id);
    const data = {};
    sheets.forEach(sh=>{ data[sh.key] = sh.value; });
    download(fileBase(id) + '.json', new Blob([JSON.stringify({
      app:'lionstack', part:id, exportedAt:new Date().toISOString(),
      keys: sheets.map(s=> s.key), data
    }, null, 2)], { type:'application/json' }));
  }
  async function exportXlsx(id){
    const { buffer, oversize } = await xlsxBufferOf(id);
    download(fileBase(id) + '.xlsx', new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    if(oversize && oversize.length) alert(T('ie.oversize').replace('{n}', oversize.length) + '\n\n' + oversize.join('\n'));
  }
  async function exportCsv(id){
    const sheets = await readSheets(id);
    if(sheets.length === 1){
      const { fields, rows } = sheetRows(sheets[0].value, sheets[0].kind, false);
      download(fileBase(id) + '.csv', new Blob(['\uFEFF' + csvOf(fields, rows)], { type:'text/csv;charset=utf-8' }));
      return;
    }
    const JSZip = await needZip();                 // several sheets can't live in one csv
    const zip = new JSZip();
    sheets.forEach(sh=>{
      const { fields, rows } = sheetRows(sh.value, sh.kind, false);
      zip.file(safeName(sh.name) + '.csv', '\uFEFF' + csvOf(fields, rows));
    });
    download(fileBase(id) + '-csv.zip', await zip.generateAsync({ type:'blob' }));
  }
  // Overall download: one zip holding every page's xlsx and csv.
  async function exportOverallZip(){
    const JSZip = await needZip();
    const zip = new JSZip();
    for(const g of dataGroups()){
      const { buffer } = await xlsxBufferOf(g.id);
      const part = g.id.replace(/^ie/,'').toLowerCase();
      zip.file('xlsx/' + part + '.xlsx', new Uint8Array(buffer));
      for(const sh of await readSheets(g.id)){
        const { fields, rows } = sheetRows(sh.value, sh.kind, false);
        zip.file('csv/' + part + '/' + safeName(sh.name) + '.csv', '\uFEFF' + csvOf(fields, rows));
      }
    }
    const all = {};
    for(const sh of await readSheets('ieOverall')) all[sh.key] = sh.value;
    zip.file('lionstack-overall-' + stamp() + '.json', JSON.stringify({ app:'lionstack', part:'ieOverall', exportedAt:new Date().toISOString(), data: all }, null, 2));
    download('lionstack-backup-' + stamp() + '.zip', await zip.generateAsync({ type:'blob' }));
  }

  /* ---------------- import ---------------- */
  async function importJson(id, file, onDone){
    let parsed;
    try{ parsed = JSON.parse(await file.text()); }
    catch(e){ alert(T('ie.errParse')); return; }
    const data = (parsed && parsed.data) ? parsed.data : parsed;
    if(!data || typeof data !== 'object'){ alert(T('ie.errShape')); return; }
    const allowed = sheetsOf(id).map(s=> s.key);
    const incoming = Object.keys(data).filter(k=> allowed.indexOf(k) >= 0);
    const skipped = Object.keys(data).length - incoming.length;
    if(!incoming.length){ alert(T('ie.errNoKeys')); return; }
    const lines = incoming.map(k=> '\u2022 ' + k + ' (' + countOf(data[k]) + ')').join('\n');
    if(!window.confirm(T('ie.confirm').replace('{n}', incoming.length) + '\n\n' + lines + (skipped ? '\n\n' + T('ie.skipped').replace('{n}', skipped) : ''))) return;
    for(const k of incoming) await window.Store.set(k, data[k]);
    alert(T('ie.done').replace('{n}', incoming.length));
    if(typeof onDone === 'function') onDone();
  }

  async function importXlsx(id, file, onDone){
    const XLSX = await needXLSX();
    let wb;
    try{ wb = XLSX.read(await file.arrayBuffer(), { type:'array' }); }
    catch(e){ alert(T('ie.errParse')); return; }

    // 1) every cell must be text
    const bad = [];
    wb.SheetNames.forEach(name=>{
      const ws = wb.Sheets[name];
      Object.keys(ws).forEach(addr=>{
        if(addr[0] === '!') return;
        if(ws[addr].t !== 's') bad.push(name + '!' + addr + ' (' + ws[addr].t + ')');
      });
    });
    if(bad.length){
      alert(T('ie.errNotText').replace('{n}', bad.length) + '\n\n' + bad.slice(0, 12).join('\n') + (bad.length > 12 ? '\n…' : ''));
      return;
    }

    // 2) types from _meta when the file carries it
    const metaTypes = {};   // sheetName -> { field: type }
    if(wb.Sheets['_meta']){
      XLSX.utils.sheet_to_json(wb.Sheets['_meta'], { header:1, defval:'' }).slice(1).forEach(r=>{
        const [shName, field, type] = r;
        if(!shName || !field) return;
        if(!metaTypes[shName]) metaTypes[shName] = {};
        metaTypes[shName][field] = type || 't';
      });
    }

    // 3) match sheets to this page and validate the header row
    const targets = sheetsOf(id);
    const plan = [];
    const problems = [];
    for(const sh of targets){
      const name = safeName(sh.name);
      const ws = wb.Sheets[name] || wb.Sheets[sh.name];
      if(!ws) continue;                                  // sheet simply not in the file
      const aoa = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
      const header = (aoa[0] || []).map(h=> String(h).trim()).filter(h=> h !== '');
      const currentValue = await window.Store.get(sh.key);
      const current = sheetRows(currentValue, sh.kind, false).fields;
      const expected = current.length ? current : Object.keys(metaTypes[sh.name] || {});
      if(expected.length){
        const missing = expected.filter(f=> header.indexOf(f) < 0);
        const extra = header.filter(f=> expected.indexOf(f) < 0);
        if(missing.length || extra.length){
          problems.push(sh.name + ': ' + (missing.length ? T('ie.hdrMissing') + ' ' + missing.join(', ') : '') + (missing.length && extra.length ? ' · ' : '') + (extra.length ? T('ie.hdrExtra') + ' ' + extra.join(', ') : ''));
          continue;
        }
      }
      const types = metaTypes[sh.name] || {};
      if(!Object.keys(types).length) header.forEach(f=> { types[f] = 't'; });
      plan.push({ sh, header, types, currentValue, rows: aoa.slice(1).filter(r=> r.some(c=> String(c).trim() !== '')) });
    }

    if(problems.length){
      alert(T('ie.errHeader') + '\n\n' + problems.join('\n'));
      return;
    }
    if(!plan.length){ alert(T('ie.errNoSheets')); return; }

    const lines = plan.map(p=> '\u2022 ' + p.sh.name + ' (' + p.rows.length + ')').join('\n');
    if(!window.confirm(T('ie.confirm').replace('{n}', plan.length) + '\n\n' + lines)) return;

    for(const p of plan){
      let value;
      try{ value = rowsToValue(p.header, p.types, p.rows, p.sh.kind, p.currentValue); }
      catch(e){ alert(T('ie.errCell').replace('{s}', p.sh.name) + '\n' + e.message); return; }
      await window.Store.set(p.sh.key, value);
    }
    alert(T('ie.done').replace('{n}', plan.length));
    if(typeof onDone === 'function') onDone();
  }

  /* ---------------- ui ---------------- */
  function drawSubnav(container){
    const nav = container.querySelector('#ieSubnav');
    if(!nav) return;
    nav.innerHTML = SUBPAGES.map(sp=>
      `<button type="button" class="acc-subnav-btn ${sp===subPage?'active':''}" data-subpage="${sp}">${esc(T('sub.'+sp))}</button>`
    ).join('');
  }

  async function drawBody(container){
    const body = container.querySelector('#ieBody');
    if(!body) return;
    const g = groupOf(subPage);
    const derived = !!(g.sheets && g.sheets.length === 0);
    const sheets = derived ? [] : await readSheets(subPage);
    const total = sheets.reduce((s,sh)=> s + countOf(sh.value), 0);
    const isOverall = subPage === 'ieOverall';

    body.innerHTML = `
      <div class="panel">
        <h4 class="art-form-section" style="margin-top:0;">${esc(T('sub.'+subPage))}</h4>
        <p class="setting-desc" style="margin-top:-6px;">${esc(T('desc.'+subPage))}</p>

        ${derived ? `<p class="setting-desc art-pending-due">\u26A0 ${esc(T('ie.derived').replace('{p}', (g.reads||[]).map(r=> T('sub.'+r)).join(', ')))}</p>` : `
        <div class="art-sum-cards">
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('ie.sheets'))}</div><div class="art-stat-value">${sheets.length}</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('ie.records'))}</div><div class="art-stat-value">${total}</div></div>
        </div>

        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr><th>${esc(T('ie.sheet'))}</th><th>${esc(T('ie.key'))}</th><th class="num">${esc(T('ie.records'))}</th></tr></thead>
            <tbody>${sheets.map(sh=> `<tr><td><b>${esc(sh.name)}</b></td><td class="art-id">${esc(sh.key)}</td><td class="num">${countOf(sh.value)}</td></tr>`).join('')}</tbody>
          </table>
        </div>

        <div class="ie-actions">
          <span class="ie-label">${esc(T('ie.exportAs'))}</span>
          <button class="btn btn-primary" id="ieXlsx">XLSX</button>
          <button class="btn btn-ghost" id="ieCsv">CSV</button>
          <button class="btn btn-ghost" id="ieJson">JSON</button>
          ${isOverall ? `<button class="btn btn-primary" id="ieZip">${esc(T('ie.zip'))}</button>` : ''}
        </div>
        <p class="setting-desc">${esc(T('ie.exportHint'))}</p>

        <div class="ie-actions">
          <span class="ie-label">${esc(T('ie.importAs'))}</span>
          <label class="file-picker">
            <input type="file" id="ieImport" accept=".xlsx,.json,application/json">
            <span class="file-picker-btn">${esc(T('ie.import'))}</span>
          </label>
        </div>
        <p class="setting-desc">${esc(T('ie.importHint'))}</p>
        ${isOverall ? `<p class="setting-desc art-pending-due">\u26A0 ${esc(T('ie.overallWarn'))}</p>` : ''}
        `}
      </div>`;

    if(derived) return;
    const run = async (fn)=>{
      try{ await fn(); }
      catch(e){ alert(T('ie.errLib') + '\n' + (e && e.message ? e.message : e)); }
    };
    body.querySelector('#ieXlsx').addEventListener('click', ()=> run(()=> exportXlsx(subPage)));
    body.querySelector('#ieCsv').addEventListener('click', ()=> run(()=> exportCsv(subPage)));
    body.querySelector('#ieJson').addEventListener('click', ()=> run(()=> exportJson(subPage)));
    const zipBtn = body.querySelector('#ieZip');
    if(zipBtn) zipBtn.addEventListener('click', ()=> run(exportOverallZip));

    body.querySelector('#ieImport').addEventListener('change', async (e)=>{
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if(!file) return;
      const done = ()=> location.reload();     // let every module re-read its data
      const name = (file.name || '').toLowerCase();
      if(name.endsWith('.json')) await run(()=> importJson(subPage, file, done));
      else if(name.endsWith('.xlsx')) await run(()=> importXlsx(subPage, file, done));
      else alert(T('ie.errFormat'));
    });
  }

  window.registerModuleI18n(ID, {
    th: {
      'title':'นำเข้า / ส่งออก', 'crumb':'สำรองและกู้คืนข้อมูลแยกตามหน้า',
      'sub.ieOverall':'ทั้งหมด', 'sub.ieStock':'จัดการสต๊อก', 'sub.ieSell':'การขาย', 'sub.ieDelivery':'การจัดส่ง',
      'sub.ieStorefront':'หน้าร้าน', 'sub.ieRevenue':'รายได้ & บัญชี', 'sub.ieCogs':'ต้นทุนขาย & มูลค่าสต๊อก',
      'sub.ieExpense':'รายจ่าย & เจ้าหนี้', 'sub.ieFinancial':'รายงานการเงิน', 'sub.iePayroll':'เงินเดือน',
      'sub.ieCalendar':'ปฏิทินพนักงาน', 'sub.ieEmployees':'พนักงาน & สิทธิ์', 'sub.ieSetting':'ตั้งค่าทั้งหมด',
      'desc.ieOverall':'สำรองทั้งระบบ — ปุ่ม ZIP จะได้ไฟล์ xlsx + csv ของทุกหน้า พร้อมไฟล์ JSON สำรองในไฟล์เดียว',
      'desc.ieStock':'สินค้า · ต้นทุน (lot) · ประวัติสต๊อก · ประวัติแก้ไขสินค้า · สินค้าที่ถูกลบ',
      'desc.ieSell':'บิลขาย · ประวัติแก้ไขบิล · บิลที่ถูกลบ',
      'desc.ieDelivery':'ข้อมูลการจัดส่งของแต่ละบิล',
      'desc.ieStorefront':'ตั้งค่าหน้าร้านและเวอร์ชันที่เผยแพร่',
      'desc.ieRevenue':'หน้านี้อ่านข้อมูลจากบิลขาย ไม่มีข้อมูลของตัวเอง',
      'desc.ieCogs':'คำนวณจากบิลขายและ lot ต้นทุน ไม่มีข้อมูลของตัวเอง',
      'desc.ieExpense':'ค่าใช้จ่ายดำเนินงาน · ประวัติแก้ไข · รายจ่ายค่าสินค้าที่ระบบลงให้',
      'desc.ieFinancial':'รายงานทั้งหมดคำนวณสด ไม่มีข้อมูลของตัวเอง',
      'desc.iePayroll':'ค่าเงิน · ค่าเงินรายพนักงาน · การอนุมัติปิดงวด',
      'desc.ieCalendar':'วันลาของพนักงาน',
      'desc.ieEmployees':'พนักงาน · บทบาท · สิทธิ์การเข้าถึง',
      'desc.ieSetting':'รวมทุกหน้าตั้งค่าไว้ด้วยกัน (แท็ก สถานะ ช่องทางขาย คอมมิชชั่น ข้อมูลธุรกิจ โปรโมชัน)',
      'ie.sheets':'จำนวนชีต', 'ie.records':'จำนวนรายการ', 'ie.sheet':'ชีต', 'ie.key':'ชุดข้อมูล',
      'ie.exportAs':'ส่งออกเป็น', 'ie.importAs':'นำเข้า', 'ie.import':'เลือกไฟล์ (.xlsx / .json)', 'ie.zip':'ZIP ทั้งหมด',
      'ie.exportHint':'xlsx = 1 ชีตต่อ 1 หน้าย่อย ทุกช่องเป็นข้อความ · csv หลายชีตจะรวมเป็นไฟล์ zip · json ใช้กู้คืนได้ครบที่สุด',
      'ie.importHint':'นำเข้าได้เฉพาะ .xlsx และ .json · ระบบจะเช็คหัวตารางให้ตรงกับหน้านี้ก่อน แล้วถามยืนยันก่อนเขียนทับ',
      'ie.overallWarn':'การนำเข้าที่หน้านี้เขียนทับข้อมูลทั้งระบบ — ส่งออกไฟล์สำรองไว้ก่อนเสมอ',
      'ie.derived':'หน้านี้ไม่มีข้อมูลของตัวเอง — สำรอง/กู้คืนได้ที่ {p}',
      'ie.confirm':'ยืนยันนำเข้า {n} ชุดข้อมูล และเขียนทับของเดิม?',
      'ie.skipped':'ข้ามอีก {n} ชุดข้อมูลที่ไม่ใช่ของหน้านี้',
      'ie.done':'นำเข้าเรียบร้อย {n} ชุดข้อมูล — กำลังโหลดหน้าใหม่',
      'ie.oversize':'\u0E21\u0E35 {n} \u0E04\u0E2D\u0E25\u0E31\u0E21\u0E19\u0E4C\u0E17\u0E35\u0E48\u0E22\u0E32\u0E27\u0E40\u0E01\u0E34\u0E19\u0E17\u0E35\u0E48 Excel \u0E23\u0E31\u0E1A\u0E44\u0E14\u0E49 (32,767 \u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23/\u0E0A\u0E48\u0E2D\u0E07) \u2014 \u0E43\u0E19\u0E44\u0E1F\u0E25\u0E4C xlsx \u0E08\u0E30\u0E40\u0E1B\u0E47\u0E19 __OVERSIZE__ \u0E41\u0E25\u0E30\u0E15\u0E2D\u0E19\u0E19\u0E33\u0E40\u0E02\u0E49\u0E32\u0E01\u0E25\u0E31\u0E1A\u0E23\u0E30\u0E1A\u0E1A\u0E08\u0E30\u0E04\u0E07\u0E04\u0E48\u0E32\u0E40\u0E14\u0E34\u0E21\u0E44\u0E27\u0E49\u0E43\u0E2B\u0E49 \u00B7 \u0E16\u0E49\u0E32\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23\u0E04\u0E23\u0E1A\u0E08\u0E23\u0E34\u0E07\u0E43\u0E2B\u0E49\u0E43\u0E0A\u0E49 JSON', 'ie.errParse':'อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ที่ส่งออกจากระบบนี้',
      'ie.errShape':'รูปแบบไฟล์ไม่ถูกต้อง',
      'ie.errNoKeys':'ไฟล์นี้ไม่มีข้อมูลที่ตรงกับหน้านี้',
      'ie.errNoSheets':'ไม่พบชีตที่ตรงกับหน้านี้ในไฟล์',
      'ie.errFormat':'นำเข้าได้เฉพาะไฟล์ .xlsx และ .json เท่านั้น',
      'ie.errNotText':'ไฟล์นี้มี {n} ช่องที่ไม่ใช่ข้อความ — ต้องจัดรูปแบบทุกช่องเป็น Text ก่อนนำเข้า',
      'ie.errHeader':'หัวตารางไม่ตรงกับหน้านี้ จึงไม่นำเข้าให้',
      'ie.hdrMissing':'ขาดคอลัมน์:', 'ie.hdrExtra':'มีคอลัมน์เกิน:',
      'ie.errCell':'แปลงข้อมูลในชีต {s} ไม่ได้',
      'ie.errLib':'ทำงานไม่สำเร็จ (อาจโหลดตัวอ่านไฟล์ไม่ได้ ต้องต่อเน็ตครั้งแรก)'
    },
    en: {
      'title':'Import / Export', 'crumb':'Back up and restore, page by page',
      'sub.ieOverall':'Overall', 'sub.ieStock':'Stock Management', 'sub.ieSell':'Sell Management', 'sub.ieDelivery':'Delivery',
      'sub.ieStorefront':'Storefront', 'sub.ieRevenue':'Revenue & Accounting', 'sub.ieCogs':'COGS & Inventory',
      'sub.ieExpense':'Expense & Payable', 'sub.ieFinancial':'Financial Report', 'sub.iePayroll':'Payroll',
      'sub.ieCalendar':'Employee Calendar', 'sub.ieEmployees':'Employees & Access', 'sub.ieSetting':'All Settings',
      'desc.ieOverall':'Whole-system backup — the ZIP button gives you every page as xlsx + csv plus a JSON backup in one file',
      'desc.ieStock':'Products · cost lots · stock history · product edit history · deleted products',
      'desc.ieSell':'Bills · bill edit history · deleted bills',
      'desc.ieDelivery':'Delivery details per bill',
      'desc.ieStorefront':'Storefront configuration and the published snapshot',
      'desc.ieRevenue':'Reads the sales bills — owns no data of its own',
      'desc.ieCogs':'Computed from bills and cost lots — owns no data of its own',
      'desc.ieExpense':'Operating expenses · their edit log · auto-posted stock expenses',
      'desc.ieFinancial':'Every report is computed live — owns no data of its own',
      'desc.iePayroll':'Components · per-employee lines · authorized periods',
      'desc.ieCalendar':'Employee leave records',
      'desc.ieEmployees':'Staff · roles · access grants',
      'desc.ieSetting':'All settings pages share one blob (tags, statuses, channels, commission, business profile, promotions)',
      'ie.sheets':'Sheets', 'ie.records':'Records', 'ie.sheet':'Sheet', 'ie.key':'Data set',
      'ie.exportAs':'Export as', 'ie.importAs':'Import', 'ie.import':'Choose a file (.xlsx / .json)', 'ie.zip':'ZIP everything',
      'ie.exportHint':'xlsx = one sheet per subpage, every cell text · multi-sheet csv comes as a zip · json restores most faithfully',
      'ie.importHint':'Only .xlsx and .json can be imported · headers are checked against this page first, then you confirm before anything is written',
      'ie.overallWarn':'Importing here overwrites the whole system — always export a backup first',
      'ie.derived':'No data of its own — back it up under {p}',
      'ie.confirm':'Import {n} data set(s) and overwrite the current ones?',
      'ie.skipped':'{n} other data set(s) in the file were skipped',
      'ie.done':'Imported {n} data set(s) — reloading',
      'ie.oversize':'{n} column(s) exceed what an Excel cell can hold (32,767 chars) — they are written as __OVERSIZE__ and left untouched when this file is imported back · use JSON for a complete copy', 'ie.errParse':'Could not read the file — it must be one exported from this app',
      'ie.errShape':'Unexpected file shape',
      'ie.errNoKeys':'This file holds nothing that belongs to this page',
      'ie.errNoSheets':'No sheet in this file matches this page',
      'ie.errFormat':'Only .xlsx and .json files can be imported',
      'ie.errNotText':'{n} cell(s) in this file are not text — format every cell as Text before importing',
      'ie.errHeader':'The header row does not match this page, so nothing was imported',
      'ie.hdrMissing':'missing:', 'ie.hdrExtra':'unexpected:',
      'ie.errCell':'Could not rebuild the records in sheet {s}',
      'ie.errLib':'That failed (the file reader may not have loaded — it needs the internet the first time)'
    }
  });

  window.registerModule({
    id: ID,
    navLabel: { th:'นำเข้า / ส่งออก', en:'Import / Export' },
    pageId: 'page-importExport',
    subpages: SUBPAGES,
    async onInit(){},
    mount(container){
      container.innerHTML = `
        <div class="topbar">
          <h1>${esc(T('title'))}</h1>
          <div class="crumb">${esc(T('crumb'))}</div>
        </div>
        <div class="content">
          <div class="acc-subnav store-subnav" id="ieSubnav"></div>
          <div id="ieBody"></div>
        </div>`;
      container.querySelector('#ieSubnav').addEventListener('click', (e)=>{
        const btn = e.target.closest('[data-subpage]');
        if(!btn) return;
        subPage = btn.dataset.subpage;
        this.render();
      });
      this.render();
    },
    render(){
      const container = document.getElementById('page-importExport');
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
