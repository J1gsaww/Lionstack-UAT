/* ============================================================
   ARTISAN CRAB MODULE — handmade resin keycap business console

   Ported from the standalone Artisan Crab "Accounting" app into a Base App
   module. Sub-pages (built incrementally):
     expense · summary · revenue · orderStatus · invoiceStatus ·
     products · setting · backup

   This file owns only its own Store keys (mod_artisan_*). Tags and statuses
   are user-editable (see the Setting sub-page) and stored as config, so the
   old hard-coded TAGS / ORDER_STATUSES / INVOICE_STATUSES become defaults
   that seed the config the first time the module runs.
   ============================================================ */
(function(){
  const ID = 'simplestore';
  const esc = window.escapeHtml;
  const T = (k)=> window.moduleI18n(ID)(k);

  /* ---- Store keys ---- */
  const K_EXPENSES = 'mod_store_expenses';
  const K_ORDERS   = 'mod_store_orders';
  const K_PRODUCTS = 'mod_store_products';
  const K_STOCKLOG = 'mod_store_stocklog';
  const K_CONFIG   = 'mod_store_config';   // { expenseTags, revenueTags, orderStatuses, invoiceStatuses }
  const K_PROMOS   = 'mod_store_promotions'; // [{ id, name, effectiveDate, endDate, items:[{productId,percent}], closed, endedAck }]

  /* ---- Default tags / statuses (seed config on first run) ---- */
  const DEFAULT_EXPENSE_TAGS = [
    { name:'Instrument',      color:'#7C6A55' },
    { name:'Fix Cost',        color:'#FDBD31' },
    { name:'Production Cost',  color:'#FB7562' },
    { name:'Convenience',     color:'#6B8F71' },
    { name:'Future usage',    color:'#9B8B78' },
    { name:'Waste',           color:'#C6432E' }
  ];
  const DEFAULT_REVENUE_TAGS = [
    { name:'From Stock', color:'#6B8F71' },
    { name:'Pre-Order',  color:'#FDBD31' }
  ];
  const DEFAULT_ORDER_STATUSES = [
    { name:'Quotation',        color:'#9B8B78' },
    { name:'Confirmed',        color:'#FDBD31' },
    { name:'Deposit Received', color:'#E0A100' },
    { name:'In Production',    color:'#FB7562' },
    { name:'Ready to Ship',    color:'#C97B4E' },
    { name:'Shipped',          color:'#7C6A55' },
    { name:'Completed',        color:'#6B8F71', role:'complete', locked:true }
  ];
  const DEFAULT_INVOICE_STATUSES = [
    { name:'Draft',          color:'#9B8B78' },
    { name:'Sent',           color:'#FDBD31' },
    { name:'Partially paid', color:'#FB7562' },
    { name:'Paid',           color:'#6B8F71', role:'paid', locked:true }
  ];
  const DEFAULT_BROUGHT_FROM = ['Local Shop', 'Shopee', 'Lazada'];
  const DEFAULT_PRODUCT_TYPES = [
    { name:'Type A', color:'#6B8F71' },
    { name:'Type B', color:'#FDBD31' },
    { name:'Type C', color:'#FB7562' }
  ];

  /* ---- State ---- */
  let subPage = 'expense';
  let config = null;   // { expenseTags:[], revenueTags:[], orderStatuses:[], invoiceStatuses:[] }
  let expenses = [];
  let expFilter = { from:'', to:'', tag:'all' };
  let expEditingId = null;
  let expEditingOrigDate = null;
  let orders = [];
  let ordFilter = { from:'', to:'', orderStatus:'all', invoiceStatus:'all', tag:'all' };
  let ordEditingId = null;
  let products = [];
  let stockLog = [];
  let promotions = [];
  let prodEditingId = null;
  let prodImageData = null;
  const PRODUCT_TAGS = [
    { name:'In Stock',     color:'#6B8F71' },
    { name:'Pre-Order',    color:'#FDBD31' },
    { name:'Out of Stock', color:'#C6432E' }
  ];

  const SUBPAGES = ['expense','summary','account','revenue','orderStatus','invoiceStatus','products','stockHistory','setting'];

  /* ---- Config load / save ---- */
  async function loadConfig(){
    const saved = await window.Store.get(K_CONFIG);
    if(saved && saved.expenseTags){ config = saved; migrateConfigRoles(); return; }
    // Seed once from defaults.
    config = {
      expenseTags: DEFAULT_EXPENSE_TAGS.map(x=> ({ id: rid(), ...x })),
      revenueTags: DEFAULT_REVENUE_TAGS.map(x=> ({ id: rid(), ...x })),
      orderStatuses: DEFAULT_ORDER_STATUSES.map(x=> ({ id: rid(), ...x })),
      invoiceStatuses: DEFAULT_INVOICE_STATUSES.map(x=> ({ id: rid(), ...x })),
      broughtFrom: DEFAULT_BROUGHT_FROM.map(n=> ({ id: rid(), name: n })),
      productTypes: DEFAULT_PRODUCT_TYPES.map(x=> ({ id: rid(), ...x })),
      prefixes: { expense: 'CSA', order: 'ATSC' },
      business: { name:'', address:'', phone:'', taxId:'', logo:'', signature:'', stamp:'', vatDefault:false }
    };
    await saveConfig();
  }
  // Ensure a locked "complete" order status and a locked "paid" invoice status
  // always exist — these drive stock accounting and must not be deletable.
  function migrateConfigRoles(){
    let changed = false;
    const os = config.orderStatuses || [];
    if(!os.some(s=> s.role === 'complete') && os.length){ os[os.length-1].role = 'complete'; os[os.length-1].locked = true; changed = true; }
    const is = config.invoiceStatuses || [];
    if(!is.some(s=> s.role === 'paid') && is.length){ is[is.length-1].role = 'paid'; is[is.length-1].locked = true; changed = true; }
    if(!config.broughtFrom){ config.broughtFrom = DEFAULT_BROUGHT_FROM.map(n=> ({ id: rid(), name: n })); changed = true; }
    if(!config.productTypes){ config.productTypes = DEFAULT_PRODUCT_TYPES.map(x=> ({ id: rid(), ...x })); changed = true; }
    if(!config.prefixes){ config.prefixes = { expense: 'CSA', order: 'ATSC' }; changed = true; }
    if(!config.business){ config.business = { name:'', address:'', phone:'', taxId:'', logo:'', signature:'', stamp:'', vatDefault:false }; changed = true; }
    if(changed) saveConfig();
  }
  function statusByRole(group, role){ return (config[group] || []).find(s=> s.role === role) || null; }
  async function saveConfig(){ await window.Store.set(K_CONFIG, config); }
  function rid(){ return 'a' + Math.random().toString(36).slice(2,10); }

  /* ---- Promotions ----
     A product is "on sale" only through an active promotion — there is no
     per-product flag. A promotion is active when today is within its
     [effectiveDate, endDate] window (app timezone). Because a client-only /
     Firestore setup runs no background jobs, expiry is enforced lazily: on app
     open, runPromoConditionCheck() closes any window that has passed and flags
     it for a one-time Base App notification. Until the owner reopens the app,
     an expired promo simply keeps running — their responsibility, by design. */
  async function savePromotions(){ await window.Store.set(K_PROMOS, promotions); }

  // Highest active discount % for a product today (0 = not on sale). If two live
  // promotions cover the same product, the bigger discount wins.
  function activePromoPercent(productId){
    const today = window.localIso();
    let best = 0;
    for(const p of promotions){
      if(p.effectiveDate && p.effectiveDate > today) continue;  // not started yet
      if(p.endDate && p.endDate < today) continue;              // already over
      const it = (p.items || []).find(x=> x.productId === productId);
      if(it && (it.percent || 0) > best) best = it.percent;
    }
    return best;
  }

  // Run once at app open: close any promo past its end date and flag it so the
  // notification provider announces it exactly once.
  async function runPromoConditionCheck(){
    const today = window.localIso();
    let changed = false;
    promotions.forEach(p=>{
      if(!p.closed && p.endDate && p.endDate < today){ p.closed = true; p.endedAck = false; changed = true; }
    });
    if(changed) await savePromotions();
  }

  /* ---- Module registration ---- */
  window.registerModule({
    id: ID,
    navLabel: { th: '\u0E23\u0E49\u0E32\u0E19\u0E04\u0E49\u0E32', en: 'Simple Store' },
    pageId: 'page-simplestore',

    async onInit(){
      await loadConfig();
      expenses = await window.Store.list(K_EXPENSES);
      orders = await window.Store.list(K_ORDERS);
      products = await window.Store.list(K_PRODUCTS);
      stockLog = await window.Store.list(K_STOCKLOG);
      promotions = await window.Store.list(K_PROMOS);
      await runPromoConditionCheck();   // lazy expiry: close promos that ended while the app was closed
      // Feed the Base App notification inbox: one item per promo auto-closed and
      // not yet acknowledged. Clicking it marks it seen so it won't reappear.
      if(window.registerNotifyProvider){
        window.registerNotifyProvider(()=> promotions
          .filter(p=> p.closed && !p.endedAck)
          .map(p=>{
            const end = p.endDate ? new Date(p.endDate + 'T23:59:59') : new Date();
            return {
              id: 'promo:' + p.id,
              kind: 'promo',
              title: T('promo.endedTitle'),
              subtitle: (p.name || T('promo.untitled')) + ' \u00B7 ' + T('promo.endedOn') + ' ' + (p.endDate || '-'),
              tag: T('promo.navLabel'),
              msLeft: end.getTime() - Date.now(),   // negative → sorts among overdue
              color: '#C6432E', ink: '#FFFFFF',
              onClick: async ()=>{ p.endedAck = true; await savePromotions(); if(window.renderSidebar) window.renderSidebar(); }
            };
          })
        );
      }
    },

    mount(container){
      container.innerHTML = `
        <div class="topbar">
          <h1>${esc(T('title'))}</h1>
          <div class="crumb">${esc(T('crumb'))}</div>
        </div>
        <div class="content">
          <div class="acc-subnav store-subnav" id="storeSubnav"></div>
          <div id="storeBody"></div>
        </div>`;
      container.querySelector('#storeSubnav').addEventListener('click', (e)=>{
        const btn = e.target.closest('[data-subpage]');
        if(!btn) return;
        subPage = btn.dataset.subpage;
        this.render();
      });
    },

    render(){
      const nav = document.querySelector('#storeSubnav');
      const body = document.querySelector('#storeBody');
      if(!nav || !body) return;
      nav.innerHTML = SUBPAGES.map(id=>
        `<button type="button" class="acc-subnav-btn ${id===subPage?'active':''}" data-subpage="${id}">${esc(T('nav.'+id))}</button>`
      ).join('');

      if(subPage === 'setting') renderSettingPage(body);
      else if(subPage === 'expense') renderExpensePage(body);
      else if(subPage === 'summary') renderSummaryPage(body);
      else if(subPage === 'account') renderAccountPage(body);
      else if(subPage === 'revenue') renderRevenuePage(body);
      else if(subPage === 'products') renderProductsPage(body);
      else if(subPage === 'orderStatus') renderOrderKanban(body);
      else if(subPage === 'invoiceStatus') renderInvoiceKanban(body);
      else if(subPage === 'stockHistory') renderStockHistory(body);
      else body.innerHTML = `<div class="panel"><p class="setting-desc">${esc(T('soon'))}</p></div>`;
    },

    // Registers this module's Export/Import box on the Base App's Import/Export page.
    dataTools: {
      render(){
        return `
          <div class="settings-section">
            <div class="settings-section-head">
              <h3 class="setting-title">${esc(T('io.exportTitle'))}</h3>
              <p class="setting-desc">${esc(T('io.exportDesc'))}</p>
            </div>
            <div class="if-row">
              <button class="btn btn-primary" id="storeExportJson">${esc(T('io.json'))}</button>
            </div>
            <p class="setting-desc" style="margin:12px 0 6px;">${esc(T('io.csvExportLabel'))}</p>
            <div class="if-row">
              <button class="btn btn-ghost" id="storeExportExpCsv">${esc(T('io.csvExp'))}</button>
              <button class="btn btn-ghost" id="storeExportOrdCsv">${esc(T('io.csvOrd'))}</button>
              <button class="btn btn-ghost" id="storeExportProdCsv">${esc(T('io.csvProd'))}</button>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-head">
              <h3 class="setting-title">${esc(T('io.importTitle'))}</h3>
              <p class="setting-desc">${esc(T('io.importDesc'))}</p>
              <p class="setting-desc art-io-note">${esc(T('io.importNote'))}</p>
            </div>
            <div class="if-row">
              <label class="file-picker">
                <input type="file" id="storeImportFile" accept=".json,.csv,application/json,text/csv">
                <span class="file-picker-btn">${esc(T('io.chooseFile'))}</span>
                <span class="file-picker-name" id="storeImportName">${esc(T('io.noFile'))}</span>
              </label>
              <button class="btn btn-primary" id="storeImportBtn" disabled>${esc(T('io.importBtn'))}</button>
              <span class="if-note" id="storeImportNote"></span>
            </div>
          </div>`;
      },
      bind(section){
        section.querySelector('#storeExportJson').addEventListener('click', exportStoreJson);
        section.querySelector('#storeExportExpCsv').addEventListener('click', exportExpensesCsv);
        section.querySelector('#storeExportOrdCsv').addEventListener('click', exportOrdersCsv);
        section.querySelector('#storeExportProdCsv').addEventListener('click', exportProductsCsv);
        const file = section.querySelector('#storeImportFile');
        const btn = section.querySelector('#storeImportBtn');
        const nameEl = section.querySelector('#storeImportName');
        let pending = null;
        file.addEventListener('change', ()=>{
          const f = file.files && file.files[0];
          if(!f){ btn.disabled = true; pending = null; nameEl.textContent = T('io.noFile'); return; }
          nameEl.textContent = f.name;
          const reader = new FileReader();
          reader.onload = ()=>{ pending = { name: f.name, text: String(reader.result) }; btn.disabled = false; };
          reader.readAsText(f);
        });
        btn.addEventListener('click', async ()=>{
          if(!pending) return;
          const note = section.querySelector('#storeImportNote');
          const isCsv = /\.csv$/i.test(pending.name) || (!/^\s*[\{\[]/.test(pending.text));
          try{
            if(isCsv){
              const r = await importCsvUpsert(pending.text);
              note.textContent = T('io.csvDone').replace('{t}', T('io.tbl_'+r.target)).replace('{c}', r.created).replace('{u}', r.updated).replace('{d}', r.deleted);
            }else{
              const counts = `${expenses.length} + ${orders.length} + ${products.length}`;
              if(!window.confirm(T('io.replaceWarn').replace('{n}', counts))) return;
              await importStoreJson(pending.text);
              note.textContent = T('io.importDone');
            }
            btn.disabled = true; file.value = ''; nameEl.textContent = T('io.noFile');
          }catch(e){ note.textContent = T('io.importFail'); }
        });
      }
    }
  });

  /* ================= Export / Import (JSON) ================= */
  function exportStoreJson(){
    const blob = { app:'simplestore', schema:1, config, expenses, orders, products, stockLog, promotions };
    window.downloadFile('simplestore-backup-' + window.localIso() + '.json', JSON.stringify(blob, null, 2), 'application/json;charset=utf-8;');
  }
  async function importStoreJson(text){
    const data = JSON.parse(text);
    if(data.app !== 'simplestore' || !data.config) throw new Error('bad file');
    // Replace everything — this is a full restore, not a merge.
    config    = data.config;
    expenses  = Array.isArray(data.expenses)  ? data.expenses  : [];
    orders    = Array.isArray(data.orders)    ? data.orders    : [];
    products  = Array.isArray(data.products)  ? data.products  : [];
    stockLog  = Array.isArray(data.stockLog)  ? data.stockLog  : [];
    promotions = Array.isArray(data.promotions) ? data.promotions : [];
    migrateConfigRoles();
    await saveConfig();
    await window.Store.set(K_EXPENSES, expenses);
    await window.Store.set(K_ORDERS, orders);
    await window.Store.set(K_PRODUCTS, products);
    await window.Store.set(K_STOCKLOG, stockLog);
    await window.Store.set(K_PROMOS, promotions);
  }

  /* ---- CSV export/import (expenses + products only; orders are JSON-only) ---- */
  function csvEscape(v){
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function parseCsvLine(line){
    const out = []; let cur = ''; let q = false;
    for(let i=0;i<line.length;i++){
      const c = line[i];
      if(q){ if(c === '"'){ if(line[i+1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
      else { if(c === '"') q = true; else if(c === ',') { out.push(cur); cur = ''; } else cur += c; }
    }
    out.push(cur); return out;
  }
  function csvToRows(text){
    const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(l=> l.trim() !== '');
    if(lines.length === 0) return { header:[], rows:[] };
    const header = parseCsvLine(lines[0]).map(h=> h.trim());
    const rows = lines.slice(1).map(l=>{ const cells = parseCsvLine(l); const o = {}; header.forEach((h,i)=> o[h] = cells[i] != null ? cells[i] : ''); return o; });
    return { header, rows };
  }
  function downloadCsv(name, header, rows){
    const lines = [header.join(',')];
    rows.forEach(r=> lines.push(header.map(h=> csvEscape(r[h])).join(',')));
    window.downloadFile(name, '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8;');
  }

  const EXPENSE_COLS = ['id','expenseId','date','details','tag','costPerPiece','amount','shippingFee','discount','purchaseFrom','note','action'];
  const PRODUCT_COLS = ['id','sku','name','productType','cost','price','stock','tag','action'];

  function exportExpensesCsv(){
    downloadCsv('simplestore-expenses-' + window.localIso() + '.csv', EXPENSE_COLS,
      expenses.map(e=> ({ ...e, action:'' })));
  }
  function exportProductsCsv(){
    downloadCsv('simplestore-products-' + window.localIso() + '.csv', PRODUCT_COLS,
      products.map(p=> ({ id:p.id, sku:p.sku, name:p.name, productType:p.productType||'', cost:p.cost, price:p.price, stock:p.stock, tag:p.tag, action:'' })));
  }
  // Orders CSV is view-only (items bind to productId) — export uses readable item text.
  function exportOrdersCsv(){
    const cols = ['invoiceNumber','date','customerName','address','platform','items','discount','net','tag','orderStatus','invoiceStatus','note'];
    downloadCsv('simplestore-orders-' + window.localIso() + '.csv', cols,
      orders.map(computeOrder).map(o=> ({ ...o, items: itemsSummary(o.items) })));
  }

  // Upsert CSV import: new id → create, existing id → update, action=delete → remove.
  async function importCsvUpsert(text){
    const { header, rows } = csvToRows(text);
    const hset = new Set(header);
    let target, key, cols;
    if(hset.has('expenseId') || (hset.has('costPerPiece') && hset.has('details'))){ target = 'expenses'; }
    else if(hset.has('sku') && hset.has('price') && hset.has('stock')){ target = 'products'; }
    else throw new Error('unknown csv');

    let created = 0, updated = 0, deleted = 0;
    const list = target === 'expenses' ? expenses : products;
    rows.forEach(r=>{
      const action = (r.action || '').trim().toLowerCase();
      const id = (r.id || '').trim();
      if(action === 'delete'){
        if(id){ const i = list.findIndex(x=> x.id === id); if(i >= 0){ list.splice(i,1); deleted++; } }
        return;
      }
      if(target === 'expenses'){
        const rec = {
          id: id || rid(), expenseId: r.expenseId || '', date: r.date || '', details: r.details || '',
          tag: r.tag || '', costPerPiece: parseFloat(r.costPerPiece)||0, amount: parseFloat(r.amount)||0,
          shippingFee: parseFloat(r.shippingFee)||0, discount: -Math.abs(parseFloat(r.discount)||0),
          purchaseFrom: r.purchaseFrom || '', note: r.note || ''
        };
        const computed = computeRow(rec);
        if(!rec.expenseId && rec.date && rec.tag) computed.expenseId = generateExpenseId(rec.date, rec.tag, rec.id);
        const i = list.findIndex(x=> x.id === computed.id);
        if(i >= 0){ list[i] = computed; updated++; } else { list.push(computed); created++; }
      }else{
        const rec = {
          id: id || rid(), sku: r.sku || '', name: r.name || '', productType: r.productType || '',
          cost: parseFloat(r.cost)||0, price: parseFloat(r.price)||0, stock: parseInt(r.stock)||0,
          tag: r.tag || 'In Stock', image: null
        };
        const i = list.findIndex(x=> x.id === rec.id);
        if(i >= 0){ rec.image = list[i].image || null; list[i] = rec; updated++; } else { list.push(rec); created++; }
      }
    });
    if(target === 'expenses'){ expenses = list; await window.Store.set(K_EXPENSES, expenses); }
    else { products = list; await window.Store.set(K_PRODUCTS, products); }
    return { target, created, updated, deleted };
  }

  /* ================= Expense page ================= */
  function fmt(n){
    n = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    return n.toLocaleString('en-US', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  }
  function computeRow(r){
    const sumItemsCost = r.costPerPiece * r.amount;
    const net = sumItemsCost + r.shippingFee + r.discount;
    return { ...r, sumItemsCost, net };
  }
  // Deterministic date → 2-letter + 2-digit code (Knuth multiplicative hash).
  function dateHashCode(day, month, year){
    const HASH_CONSTANT = 2654435761n, MOD32 = 4294967296n;
    const x = BigInt(year)*10000n + BigInt(month)*100n + BigInt(day);
    const h = (x * HASH_CONSTANT) % MOD32;
    const lettersPart = Number(h % 676n);
    const digitsPart = Number((h / 676n) % 100n);
    const l1 = String.fromCharCode(65 + Math.floor(lettersPart/26));
    const l2 = String.fromCharCode(65 + (lettersPart%26));
    return `${l1}${l2}${String(digitsPart).padStart(2,'0')}`;
  }
  // Tag → single-letter code from the first letter of the (config) tag name.
  function tagLetter(tagName){ return (tagName || 'X').trim().charAt(0).toUpperCase() || 'X'; }
  function generateExpenseId(dateStr, tag, excludeId){
    const [y,m,d] = dateStr.split('-').map(Number);
    const code = dateHashCode(d, m, y);
    const letter = tagLetter(tag);
    const countSameDate = expenses.filter(e=> e.date === dateStr && e.id !== excludeId).length;
    const prefix = (config.prefixes && config.prefixes.expense) || 'CSA';
    return `${prefix}-${code}-${letter}${String(countSameDate).padStart(3,'0')}`;
  }
  function expTagColor(name){ return colorOf('expenseTags', name); }
  async function saveExpenses(){ await window.Store.set(K_EXPENSES, expenses); }

  function expenseFiltered(){
    return expenses.filter(e=>{
      if(expFilter.from && e.date < expFilter.from) return false;
      if(expFilter.to && e.date > expFilter.to) return false;
      if(expFilter.tag !== 'all' && e.tag !== expFilter.tag) return false;
      return true;
    }).sort((a,b)=> b.date.localeCompare(a.date));
  }

  function renderExpensePage(body){
    const tags = config.expenseTags || [];
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="expFrom" value="${esc(expFilter.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="expTo" value="${esc(expFilter.to)}"></div>
          <div class="art-field"><label>${esc(T('exp.tag'))}</label>
            <select id="expTagFilter">
              <option value="all">${esc(T('exp.all'))}</option>
              ${tags.map(t=> `<option value="${esc(t.name)}" ${expFilter.tag===t.name?'selected':''}>${esc(t.name)}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-ghost" id="expClearFilter">${esc(T('exp.clearFilter'))}</button>
          <div class="art-spacer"></div>
          <button class="btn btn-primary" id="expAdd">${esc(T('exp.add'))}</button>
        </div>
        <div class="art-table-wrap">
          <table class="art-table" id="expTable">
            <thead><tr>
              <th>${esc(T('exp.id'))}</th><th>${esc(T('exp.date'))}</th><th>${esc(T('exp.details'))}</th>
              <th>${esc(T('exp.tag'))}</th><th class="num">${esc(T('exp.costPerPiece'))}</th>
              <th class="num">${esc(T('exp.amount'))}</th><th class="num">${esc(T('exp.sumItems'))}</th>
              <th class="num">${esc(T('exp.shipping'))}</th><th class="num">${esc(T('exp.discount'))}</th>
              <th class="num">${esc(T('exp.net'))}</th><th>${esc(T('exp.purchaseFrom'))}</th>
              <th>${esc(T('exp.note'))}</th><th></th>
            </tr></thead>
            <tbody id="expTbody"></tbody>
            <tfoot><tr>
              <td colspan="9">${esc(T('exp.totalRows'))} (<span id="expRowCount">0</span>)</td>
              <td class="num" id="expFootTotal">0</td><td colspan="3"></td>
            </tr></tfoot>
          </table>
        </div>
        <div id="expEmpty" class="art-empty" style="display:none;"><div class="art-empty-ico">🦀</div>${esc(T('exp.empty'))}</div>
      </div>`;

    const rerender = ()=> renderExpenseTable(body);
    body.querySelector('#expFrom').addEventListener('change', e=>{ expFilter.from = e.target.value; rerender(); });
    body.querySelector('#expTo').addEventListener('change', e=>{ expFilter.to = e.target.value; rerender(); });
    body.querySelector('#expTagFilter').addEventListener('change', e=>{ expFilter.tag = e.target.value; rerender(); });
    body.querySelector('#expClearFilter').addEventListener('click', ()=>{ expFilter = { from:'', to:'', tag:'all' }; renderExpensePage(body); });
    body.querySelector('#expAdd').addEventListener('click', ()=> openExpenseModal(null, body));
    renderExpenseTable(body);
  }

  function renderExpenseTable(body){
    const list = expenseFiltered();
    const tbody = body.querySelector('#expTbody');
    const empty = body.querySelector('#expEmpty');
    const table = body.querySelector('#expTable');
    if(!tbody) return;
    if(list.length === 0){
      tbody.innerHTML = ''; table.style.display = 'none'; empty.style.display = 'block';
    }else{
      table.style.display = ''; empty.style.display = 'none';
      tbody.innerHTML = list.map(r=>{
        const d = new Date(r.date+'T00:00:00');
        const dateLabel = isNaN(d) ? r.date : (String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear());
        return `<tr data-id="${r.id}">
          <td class="art-id">${esc(r.expenseId||'-')}</td>
          <td>${dateLabel}</td>
          <td>${esc(r.details)}</td>
          <td><span class="art-pill" style="background:${esc(expTagColor(r.tag))}">${esc(r.tag)}</span></td>
          <td class="num">${fmt(r.costPerPiece)}</td>
          <td class="num">${fmt(r.amount)}</td>
          <td class="num">${fmt(r.sumItemsCost)}</td>
          <td class="num">${fmt(r.shippingFee)}</td>
          <td class="num ${r.discount<0?'art-neg':''}">${fmt(r.discount)}</td>
          <td class="num" style="font-weight:700;">${fmt(r.net)}</td>
          <td>${esc(r.purchaseFrom||'-')}</td>
          <td>${esc(r.note||'-')}</td>
          <td><div class="art-row-actions">
            <button class="acc-icon art-exp-edit" title="${esc(T('edit'))}">✎</button>
            <button class="acc-icon art-exp-del" title="${esc(T('delete'))}">✕</button>
          </div></td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('tr').forEach(tr=>{
        const id = tr.dataset.id;
        tr.querySelector('.art-exp-edit').addEventListener('click', ()=> openExpenseModal(expenses.find(e=>e.id===id), body));
        tr.querySelector('.art-exp-del').addEventListener('click', async ()=>{
          if(!window.confirm(T('exp.delConfirm'))) return;
          expenses = expenses.filter(e=> e.id !== id);
          await saveExpenses();
          renderExpenseTable(body);
        });
      });
    }
    body.querySelector('#expRowCount').textContent = list.length;
    body.querySelector('#expFootTotal').textContent = fmt(list.reduce((s,r)=> s+r.net, 0));
  }

  function openExpenseModal(row, body){
    expEditingId = row ? row.id : null;
    expEditingOrigDate = row ? row.date : null;
    const tags = config.expenseTags || [];
    const today = new Date().toISOString().slice(0,10);
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal">
        <h3 class="art-modal-title">${esc(row ? T('exp.editTitle') : T('exp.addTitle'))}</h3>
        <div class="art-modal-id">${esc(T('exp.id'))}: <span id="expIdPreview">-</span></div>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('exp.details'))}<input type="text" id="mDetails" value="${row?esc(row.details):''}"></label>
          <label>${esc(T('exp.date'))}<input type="date" id="mDate" value="${row?esc(row.date):today}"></label>
          <label>${esc(T('exp.tag'))}<select id="mTag">${tags.map(t=> `<option value="${esc(t.name)}" ${row&&row.tag===t.name?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label>${esc(T('exp.costPerPiece'))}<input type="number" id="mCost" value="${row?row.costPerPiece:0}" step="0.01"></label>
          <label>${esc(T('exp.amount'))}<input type="number" id="mAmount" value="${row?row.amount:1}" step="1"></label>
          <label>${esc(T('exp.shipping'))}<input type="number" id="mShip" value="${row?row.shippingFee:0}" step="0.01"></label>
          <label>${esc(T('exp.discount'))}<input type="number" id="mDisc" value="${row?Math.abs(row.discount):0}" step="0.01"></label>
          <label>${esc(T('exp.purchaseFrom'))}<select id="mFrom"><option value="">${esc(T('exp.pickFrom'))}</option>${(config.broughtFrom||[]).map(b=>`<option value="${esc(b.name)}" ${row&&row.purchaseFrom===b.name?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label>
          <label class="art-form-full">${esc(T('exp.note'))}<input type="text" id="mNote" value="${row?esc(row.note||''):''}"></label>
        </div>
        <div class="art-modal-preview">
          <span>${esc(T('exp.sumItems'))}: <b id="mPvSum">0</b></span>
          <span>${esc(T('exp.net'))}: <b id="mPvNet">0</b></span>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="mCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="mSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const g = (id)=> ov.querySelector('#'+id);
    const updatePreview = ()=>{
      const cpp = parseFloat(g('mCost').value)||0, amt = parseFloat(g('mAmount').value)||0;
      const ship = parseFloat(g('mShip').value)||0, disc = -Math.abs(parseFloat(g('mDisc').value)||0);
      g('mPvSum').textContent = fmt(cpp*amt);
      g('mPvNet').textContent = fmt(cpp*amt + ship + disc);
    };
    const updateId = ()=>{
      const date = g('mDate').value, tag = g('mTag').value;
      if(!date){ g('expIdPreview').textContent = '-'; return; }
      if(expEditingId && date === expEditingOrigDate){
        const r = expenses.find(e=>e.id===expEditingId);
        g('expIdPreview').textContent = r ? r.expenseId : '-';
      }else g('expIdPreview').textContent = generateExpenseId(date, tag, expEditingId);
    };
    ['mCost','mAmount','mShip','mDisc'].forEach(id=> g(id).addEventListener('input', updatePreview));
    g('mDate').addEventListener('change', updateId);
    g('mTag').addEventListener('change', updateId);
    updatePreview(); updateId();

    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target === ov) close(); });
    g('mCancel').addEventListener('click', close);
    g('mSave').addEventListener('click', async ()=>{
      const details = g('mDetails').value.trim();
      const date = g('mDate').value, tag = g('mTag').value;
      const costPerPiece = parseFloat(g('mCost').value)||0;
      const amount = parseFloat(g('mAmount').value)||0;
      const shippingFee = parseFloat(g('mShip').value)||0;
      const discount = -Math.abs(parseFloat(g('mDisc').value)||0);
      const purchaseFrom = g('mFrom').value.trim();
      const note = g('mNote').value.trim();
      if(!details){ alert(T('exp.errDetails')); return; }
      if(!date){ alert(T('exp.errDate')); return; }
      if(amount <= 0){ alert(T('exp.errAmount')); return; }
      const rowData = computeRow({ id: expEditingId || rid(), date, details, tag, costPerPiece, amount, shippingFee, discount, purchaseFrom, note });
      if(expEditingId && date === expEditingOrigDate){
        const ex = expenses.find(e=>e.id===expEditingId);
        rowData.expenseId = ex ? ex.expenseId : generateExpenseId(date, tag, expEditingId);
      }else rowData.expenseId = generateExpenseId(date, tag, expEditingId);
      if(expEditingId) expenses = expenses.map(e=> e.id===expEditingId ? rowData : e);
      else expenses.push(rowData);
      await saveExpenses();
      close();
      renderExpenseTable(body);
    });
  }

  /* ================= Cost Summary page ================= */
  const A_SVG_NS = 'http://www.w3.org/2000/svg';
  function aSvg(name, attrs){ const el = document.createElementNS(A_SVG_NS, name); for(const k in attrs) el.setAttribute(k, attrs[k]); return el; }
  function aPolar(cx, cy, r, frac){ const a = frac*2*Math.PI - Math.PI/2; return [cx + r*Math.cos(a), cy + r*Math.sin(a)]; }

  function expMonthKey(dateStr){ return dateStr ? dateStr.slice(0,7) : ''; }
  let summaryMonth = 'all';
  // Account subpage state (income/expense ledger + VAT view).
  let acctView = 'summary';    // summary | table
  let acctYear = '';           // "YYYY"
  let acctMonth = '';          // "YYYY-MM"
  let acctVatMode = 'none';    // all | ticked | none
  let acctTableMonth = 'all';  // month filter for the table view

  function renderSummaryPage(body){
    const months = [...new Set(expenses.map(e=> expMonthKey(e.date)))].filter(Boolean).sort().reverse();
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('sum.period'))}</label>
            <select id="sumMonth">
              <option value="all" ${summaryMonth==='all'?'selected':''}>${esc(T('sum.allTime'))}</option>
              ${months.map(m=>{ const [y,mo]=m.split('-'); return `<option value="${m}" ${summaryMonth===m?'selected':''}>${monthLabel(parseInt(mo,10))} ${y}</option>`; }).join('')}
            </select>
          </div>
        </div>
        <div class="art-sum-cards" id="artSumCards"></div>
        <div class="art-sum-grid">
          <div class="art-sum-chart" id="artSumDonut"></div>
          <div class="art-sum-tablewrap">
            <table class="art-table">
              <thead><tr><th>${esc(T('sum.tag'))}</th><th class="num">${esc(T('sum.netTotal'))}</th><th class="num">${esc(T('sum.percent'))}</th></tr></thead>
              <tbody id="artSumTbody"></tbody>
              <tfoot><tr><td>${esc(T('sum.sum'))}</td><td class="num" id="artSumTotal">0</td><td class="num">100%</td></tr></tfoot>
            </table>
          </div>
        </div>
      </div>`;
    body.querySelector('#sumMonth').addEventListener('change', e=>{ summaryMonth = e.target.value; renderSummaryData(body); });
    renderSummaryData(body);
  }

  function monthLabel(m){ return window.monthName ? window.monthName(m) : ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m]; }

  function renderSummaryData(body){
    const list = summaryMonth === 'all' ? expenses : expenses.filter(e=> expMonthKey(e.date) === summaryMonth);
    const tags = config.expenseTags || [];
    const totals = {};
    tags.forEach(t=> totals[t.name] = 0);
    list.forEach(e=>{ totals[e.tag] = (totals[e.tag]||0) + e.net; });
    const grand = Object.values(totals).reduce((a,b)=> a+b, 0);

    // Cards.
    const count = list.length;
    const avg = count ? grand/count : 0;
    body.querySelector('#artSumCards').innerHTML = `
      <div class="art-stat-card"><div class="art-stat-label">${esc(T('sum.totalNet'))}</div><div class="art-stat-value">${fmt(grand)} ฿</div></div>
      <div class="art-stat-card"><div class="art-stat-label">${esc(T('sum.count'))}</div><div class="art-stat-value">${count}</div></div>
      <div class="art-stat-card"><div class="art-stat-label">${esc(T('sum.avg'))}</div><div class="art-stat-value">${fmt(avg)} ฿</div></div>`;

    // Tag table.
    body.querySelector('#artSumTbody').innerHTML = tags.map(t=>{
      const val = totals[t.name] || 0;
      const pct = grand !== 0 ? (val/grand*100) : 0;
      return `<tr>
        <td><span class="art-pill" style="background:${esc(t.color)}">${esc(t.name)}</span></td>
        <td class="num">${fmt(val)}</td>
        <td class="num">${pct.toFixed(1)}%</td>
      </tr>`;
    }).join('');
    body.querySelector('#artSumTotal').textContent = fmt(grand);

    // Donut.
    renderSummaryDonut(body.querySelector('#artSumDonut'), tags, totals, grand);
  }

  function renderSummaryDonut(host, tags, totals, grand){
    if(!host) return;
    const items = tags.map(t=> ({ name:t.name, color:t.color, value: Math.max(0, totals[t.name]||0) })).filter(it=> it.value > 0);
    if(grand <= 0 || items.length === 0){ host.innerHTML = `<p class="art-set-empty">${esc(T('sum.noData'))}</p>`; return; }
    const size=200, cx=size/2, cy=size/2, rOut=88, rIn=54;
    const svg = aSvg('svg', { viewBox:`0 0 ${size} ${size}`, class:'art-donut-svg' });
    const total = items.reduce((s,it)=> s+it.value, 0);
    if(items.length === 1){
      svg.appendChild(aSvg('circle', { cx, cy, r:(rOut+rIn)/2, fill:'none', stroke:items[0].color, 'stroke-width':rOut-rIn }));
    }else{
      let acc = 0;
      items.forEach(it=>{
        const frac = it.value/total;
        const [x1,y1]=aPolar(cx,cy,rOut,acc), [x2,y2]=aPolar(cx,cy,rOut,acc+frac);
        const [x3,y3]=aPolar(cx,cy,rIn,acc+frac), [x4,y4]=aPolar(cx,cy,rIn,acc);
        const large = frac > 0.5 ? 1 : 0;
        const d = `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 ${large} 0 ${x4} ${y4} Z`;
        svg.appendChild(aSvg('path', { d, fill: it.color }));
        acc += frac;
      });
    }
    const lbl = aSvg('text', { x:cx, y:cy-6, 'text-anchor':'middle', 'dominant-baseline':'central', 'font-size':'20', 'font-weight':'800', fill:'var(--c-text)' });
    lbl.textContent = fmt(grand);
    svg.appendChild(lbl);
    const sub = aSvg('text', { x:cx, y:cy+16, 'text-anchor':'middle', 'dominant-baseline':'central', 'font-size':'10', fill:'var(--c-muted)' });
    sub.textContent = '฿';
    svg.appendChild(sub);

    host.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className = 'art-donut-wrap';
    wrap.appendChild(svg);
    const legend = document.createElement('div'); legend.className = 'art-donut-legend';
    legend.innerHTML = items.map(it=> `<div class="art-leg-item"><span class="art-leg-dot" style="background:${it.color}"></span><span class="art-leg-name">${esc(it.name)}</span><span class="art-leg-val">${fmt(it.value)}</span></div>`).join('');
    const col = document.createElement('div'); col.className = 'art-donut-col';
    col.appendChild(wrap); col.appendChild(legend);
    host.appendChild(col);
  }

  /* ================= Account subpage: monthly income/expense + VAT =================
     Reuses the Accounting module's summary look (year/month pickers, income/
     expense/net figures) but sourced from Simple Store orders (income) and
     expenses. A 3-way VAT switch decides which items contribute VAT. */

  function acctEntries(){
    const inc = orders.map(o=>{
      const c = computeOrder(o);
      return { id:o.id, src:'order', date:o.date, type:'income',
        label:(o.customerName||'-') + (o.invoiceNumber?' · '+o.invoiceNumber:''), amount:c.net, vatable:!!o.vatable };
    });
    const exp = expenses.map(e=>({ id:e.id, src:'expense', date:e.date, type:'expense',
      label:(e.tag||T('acct.expense')) + (e.purchaseFrom?' · '+e.purchaseFrom:''), amount:e.amount||0, vatable:!!e.vatable }));
    return inc.concat(exp);
  }
  function acctYears(){
    const set = new Set(acctEntries().map(e=> (e.date||'').slice(0,4)).filter(Boolean));
    set.add(new Date().toISOString().slice(0,4));
    return [...set].sort((a,b)=> b.localeCompare(a));
  }
  function acctVatOf(amount){ return amount * 7 / 107; }   // VAT-inclusive, matching the documents
  function acctIsVatable(e){ return acctVatMode==='all' ? true : (acctVatMode==='ticked' ? !!e.vatable : false); }
  function acctSum(list){
    let inc=0, exp=0, outVat=0, inVat=0;
    list.forEach(e=>{
      if(e.type==='income'){ inc += e.amount; if(acctIsVatable(e)) outVat += acctVatOf(e.amount); }
      else { exp += e.amount; if(acctIsVatable(e)) inVat += acctVatOf(e.amount); }
    });
    return { inc, exp, net:inc-exp, outVat, inVat, vatNet:outVat-inVat };
  }
  function acctDate(iso){
    const d = new Date((iso||'')+'T00:00:00');
    if(isNaN(d)) return iso || '-';
    return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
  }

  function renderAccountPage(body){
    body.innerHTML = `
      <div class="panel">
        <div class="art-acct-toggle">
          <button type="button" class="art-acct-tab ${acctView==='summary'?'active':''}" data-av="summary">${esc(T('acct.summary'))}</button>
          <button type="button" class="art-acct-tab ${acctView==='table'?'active':''}" data-av="table">${esc(T('acct.table'))}</button>
        </div>
        <div id="acctHost"></div>
      </div>`;
    body.querySelectorAll('[data-av]').forEach(btn=> btn.addEventListener('click', ()=>{ acctView = btn.dataset.av; renderAccountPage(body); }));
    const host = body.querySelector('#acctHost');
    if(acctView === 'table') renderAccountTable(host);
    else renderAccountSummary(host);
  }

  function renderAccountSummary(host){
    const years = acctYears();
    if(!acctYear || !years.includes(acctYear)) acctYear = years[0];
    const nowY = new Date().toISOString().slice(0,4), nowM = new Date().toISOString().slice(5,7);
    if(!acctMonth || acctMonth.slice(0,4) !== acctYear) acctMonth = acctYear + '-' + (acctYear===nowY ? nowM : '01');
    const all = acctEntries();
    const monthList = Array.from({length:12}, (_,i)=> acctYear + '-' + String(i+1).padStart(2,'0'));
    const m = acctSum(all.filter(e=> (e.date||'').startsWith(acctMonth)));
    const y = acctSum(all.filter(e=> (e.date||'').startsWith(acctYear)));
    const vatOn = acctVatMode !== 'none';
    const sign = (n)=> (n>=0?'+':'-') + fmt(Math.abs(n));
    host.innerHTML = `
      <div class="acc-sum-head">
        <h3 class="setting-title">${esc(T('acct.monthlyTitle'))}</h3>
        <div class="acc-sum-pickers">
          <label class="acc-sum-picker"><span>${esc(T('acct.year'))}</span>
            <select id="acctYearSel">${years.map(yy=>`<option ${yy===acctYear?'selected':''}>${yy}</option>`).join('')}</select></label>
          <label class="acc-sum-picker"><span>${esc(T('acct.month'))}</span>
            <select id="acctMonthSel">${monthList.map(mm=>`<option value="${mm}" ${mm===acctMonth?'selected':''}>${esc(monthLabel(parseInt(mm.slice(5,7),10)))}</option>`).join('')}</select></label>
        </div>
      </div>
      <div class="art-vat-switch">
        <span class="art-vat-label">${esc(T('acct.vatMode'))}</span>
        <div class="art-vat-seg" id="acctVatSeg">
          <button type="button" data-vm="all" class="${acctVatMode==='all'?'active':''}">${esc(T('acct.vatAll'))}</button>
          <button type="button" data-vm="ticked" class="${acctVatMode==='ticked'?'active':''}">${esc(T('acct.vatTicked'))}</button>
          <button type="button" data-vm="none" class="${acctVatMode==='none'?'active':''}">${esc(T('acct.vatNone'))}</button>
        </div>
      </div>
      <div class="acc-sum-figures">
        <div class="acc-sum-fig"><span>${esc(T('acct.income'))}</span><b class="acc-income">+${esc(fmt(m.inc))}</b></div>
        <div class="acc-sum-fig"><span>${esc(T('acct.expense'))}</span><b class="acc-expense">-${esc(fmt(m.exp))}</b></div>
        <div class="acc-sum-fig"><span>${esc(T('acct.net'))}</span><b class="${m.net>=0?'acc-income':'acc-expense'}">${esc(sign(m.net))}</b></div>
        <div class="acc-sum-fig acc-sum-fig-year"><span>${esc(T('acct.yearNet'))}</span><b class="${y.net>=0?'acc-income':'acc-expense'}">${esc(sign(y.net))}</b></div>
      </div>
      ${vatOn ? `<div class="acc-sum-figures art-vat-figures">
        <div class="acc-sum-fig"><span>${esc(T('acct.outVat'))}</span><b>${esc(fmt(m.outVat))}</b></div>
        <div class="acc-sum-fig"><span>${esc(T('acct.inVat'))}</span><b>${esc(fmt(m.inVat))}</b></div>
        <div class="acc-sum-fig"><span>${esc(T('acct.vatNet'))}</span><b class="${m.vatNet>=0?'acc-income':'acc-expense'}">${esc(sign(m.vatNet))}</b></div>
      </div>` : ''}
      <div id="acctBars"></div>`;
    host.querySelector('#acctYearSel').addEventListener('change', e=>{ acctYear = e.target.value; renderAccountSummary(host); });
    host.querySelector('#acctMonthSel').addEventListener('change', e=>{ acctMonth = e.target.value; renderAccountSummary(host); });
    host.querySelectorAll('[data-vm]').forEach(b=> b.addEventListener('click', ()=>{ acctVatMode = b.dataset.vm; renderAccountSummary(host); }));
    renderAcctBars(host.querySelector('#acctBars'), all, acctYear);
  }

  function renderAcctBars(el, all, year){
    if(!el) return;
    const data = Array.from({length:12}, (_,i)=>{
      const mk = year + '-' + String(i+1).padStart(2,'0');
      const s = acctSum(all.filter(e=> (e.date||'').startsWith(mk)));
      return { inc:s.inc, exp:s.exp };
    });
    const max = Math.max(1, ...data.map(d=> Math.max(d.inc, d.exp)));
    el.innerHTML =
      `<div class="art-bars-title">${esc(T('acct.byMonth'))}</div>`+
      '<div class="art-bars">'+ data.map((d,i)=>
        `<div class="art-bar-col"><div class="art-bar-pair">`+
          `<div class="art-bar art-bar-inc" style="height:${(d.inc/max*100).toFixed(1)}%" title="+${esc(fmt(d.inc))}"></div>`+
          `<div class="art-bar art-bar-exp" style="height:${(d.exp/max*100).toFixed(1)}%" title="-${esc(fmt(d.exp))}"></div>`+
        `</div><div class="art-bar-lbl">${esc(monthLabel(i+1))}</div></div>`
      ).join('') +'</div>'+
      `<div class="art-bars-legend"><span><i class="art-dot art-bar-inc"></i>${esc(T('acct.income'))}</span><span><i class="art-dot art-bar-exp"></i>${esc(T('acct.expense'))}</span></div>`;
  }

  function renderAccountTable(host){
    const all = acctEntries().sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    const months = [...new Set(all.map(e=> (e.date||'').slice(0,7)).filter(Boolean))].sort().reverse();
    const list = acctTableMonth==='all' ? all : all.filter(e=> (e.date||'').slice(0,7)===acctTableMonth);
    host.innerHTML = `
      <div class="art-toolbar">
        <div class="art-field"><label>${esc(T('sum.period'))}</label>
          <select id="acctTblMonth">
            <option value="all" ${acctTableMonth==='all'?'selected':''}>${esc(T('sum.allTime'))}</option>
            ${months.map(mk=>{ const [y,mo]=mk.split('-'); return `<option value="${mk}" ${acctTableMonth===mk?'selected':''}>${esc(monthLabel(parseInt(mo,10)))} ${y}</option>`; }).join('')}
          </select></div>
        <div class="art-acct-tblnote">${esc(T('acct.tableNote'))}</div>
      </div>
      <table class="art-table">
        <thead><tr><th>${esc(T('acct.date'))}</th><th>${esc(T('acct.type'))}</th><th>${esc(T('acct.item'))}</th><th class="num">${esc(T('acct.amount'))}</th><th class="c">${esc(T('acct.vatable'))}</th></tr></thead>
        <tbody id="acctTblBody"></tbody>
      </table>`;
    const tb = host.querySelector('#acctTblBody');
    tb.innerHTML = list.length ? list.map(e=>`
      <tr data-src="${e.src}" data-id="${e.id}">
        <td>${esc(acctDate(e.date))}</td>
        <td><span class="art-type-badge ${e.type==='income'?'inc':'exp'}">${esc(e.type==='income'?T('acct.income'):T('acct.expense'))}</span></td>
        <td>${esc(e.label)}</td>
        <td class="num">${e.type==='income'?'+':'-'}${esc(fmt(e.amount))}</td>
        <td class="c"><input type="checkbox" class="art-vat-chk" ${e.vatable?'checked':''}></td>
      </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--c-muted);padding:24px;">${esc(T('acct.noItems'))}</td></tr>`;
    host.querySelector('#acctTblMonth').addEventListener('change', e=>{ acctTableMonth = e.target.value; renderAccountTable(host); });
    tb.querySelectorAll('tr[data-id]').forEach(tr=>{
      const chk = tr.querySelector('.art-vat-chk'); if(!chk) return;
      chk.addEventListener('change', async ()=>{
        const src = tr.dataset.src, id = tr.dataset.id;
        if(src==='order'){ const o = orders.find(x=> x.id===id); if(o){ o.vatable = chk.checked; await saveOrders(); } }
        else { const x = expenses.find(y=> y.id===id); if(x){ x.vatable = chk.checked; await saveExpenses(); } }
      });
    });
  }

  /* ================= Revenue / Orders page ================= */
  function computeOrder(o){
    const itemsTotal = (o.items||[]).reduce((s,it)=> s + (it.qty*it.price), 0);
    return { ...o, itemsTotal, net: itemsTotal - (o.discount||0) };
  }
  function generateInvoiceNumber(dateStr, excludeId){
    const [y,m,d] = dateStr.split('-').map(Number);
    const code = dateHashCode(d, m, y);
    const countSameDate = orders.filter(o=> o.date === dateStr && o.id !== excludeId).length;
    const prefix = (config.prefixes && config.prefixes.order) || 'ATSC';
    return `${prefix}-${code}-${String(countSameDate+1).padStart(3,'0')}`;
  }
  function itemsSummary(items){ return (items||[]).map(it=> `${it.productName} x${it.qty}`).join(', '); }
  function ordColor(group, name){ return colorOf(group, name); }
  async function saveOrders(){ await window.Store.set(K_ORDERS, orders); }

  function ordersFiltered(){
    return orders.filter(o=>{
      if(ordFilter.from && o.date < ordFilter.from) return false;
      if(ordFilter.to && o.date > ordFilter.to) return false;
      if(ordFilter.orderStatus !== 'all' && o.orderStatus !== ordFilter.orderStatus) return false;
      if(ordFilter.invoiceStatus !== 'all' && o.invoiceStatus !== ordFilter.invoiceStatus) return false;
      if(ordFilter.tag !== 'all' && o.tag !== ordFilter.tag) return false;
      return true;
    }).sort((a,b)=> b.date.localeCompare(a.date));
  }

  function renderRevenuePage(body){
    const oStatuses = config.orderStatuses || [];
    const iStatuses = config.invoiceStatuses || [];
    const rTags = config.revenueTags || [];
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="ordFrom" value="${esc(ordFilter.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="ordTo" value="${esc(ordFilter.to)}"></div>
          <div class="art-field"><label>${esc(T('rev.orderStatus'))}</label>
            <select id="ordOsFilter"><option value="all">${esc(T('exp.all'))}</option>${oStatuses.map(s=>`<option value="${esc(s.name)}" ${ordFilter.orderStatus===s.name?'selected':''}>${esc(s.name)}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('rev.invoiceStatus'))}</label>
            <select id="ordIsFilter"><option value="all">${esc(T('exp.all'))}</option>${iStatuses.map(s=>`<option value="${esc(s.name)}" ${ordFilter.invoiceStatus===s.name?'selected':''}>${esc(s.name)}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('exp.tag'))}</label>
            <select id="ordTagFilter"><option value="all">${esc(T('exp.all'))}</option>${rTags.map(t=>`<option value="${esc(t.name)}" ${ordFilter.tag===t.name?'selected':''}>${esc(t.name)}</option>`).join('')}</select>
          </div>
          <button class="btn btn-ghost" id="ordClearFilter">${esc(T('exp.clearFilter'))}</button>
          <div class="art-spacer"></div>
          <button class="btn btn-primary" id="ordAdd">${esc(T('rev.add'))}</button>
        </div>
        <div class="art-table-wrap">
          <table class="art-table" id="ordTable">
            <thead><tr>
              <th>${esc(T('exp.date'))}</th><th>${esc(T('rev.invoiceNo'))}</th><th>${esc(T('rev.customer'))}</th>
              <th>${esc(T('rev.platform'))}</th><th>${esc(T('rev.items'))}</th><th class="num">${esc(T('exp.discount'))}</th>
              <th class="num">${esc(T('exp.net'))}</th><th>${esc(T('exp.tag'))}</th>
              <th>${esc(T('rev.orderStatus'))}</th><th>${esc(T('rev.invoiceStatus'))}</th><th></th>
            </tr></thead>
            <tbody id="ordTbody"></tbody>
            <tfoot><tr>
              <td colspan="5">${esc(T('rev.totalRows'))} (<span id="ordRowCount">0</span>)</td>
              <td class="num" id="ordFootDisc">0</td><td class="num" id="ordFootTotal">0</td><td colspan="3"></td>
            </tr></tfoot>
          </table>
        </div>
        <div id="ordEmpty" class="art-empty" style="display:none;"><div class="art-empty-ico">📦</div>${esc(T('rev.empty'))}</div>
      </div>`;
    body.querySelector('#ordFrom').addEventListener('change', e=>{ ordFilter.from=e.target.value; renderOrdersTable(body); });
    body.querySelector('#ordTo').addEventListener('change', e=>{ ordFilter.to=e.target.value; renderOrdersTable(body); });
    body.querySelector('#ordOsFilter').addEventListener('change', e=>{ ordFilter.orderStatus=e.target.value; renderOrdersTable(body); });
    body.querySelector('#ordIsFilter').addEventListener('change', e=>{ ordFilter.invoiceStatus=e.target.value; renderOrdersTable(body); });
    body.querySelector('#ordTagFilter').addEventListener('change', e=>{ ordFilter.tag=e.target.value; renderOrdersTable(body); });
    body.querySelector('#ordClearFilter').addEventListener('click', ()=>{ ordFilter={from:'',to:'',orderStatus:'all',invoiceStatus:'all',tag:'all'}; renderRevenuePage(body); });
    body.querySelector('#ordAdd').addEventListener('click', ()=> openOrderModal(null, body));
    renderOrdersTable(body);
  }

  function renderOrdersTable(body){
    const list = ordersFiltered().map(computeOrder);
    const tbody = body.querySelector('#ordTbody');
    const table = body.querySelector('#ordTable');
    const empty = body.querySelector('#ordEmpty');
    if(!tbody) return;
    const oStatuses = config.orderStatuses || [];
    const iStatuses = config.invoiceStatuses || [];
    const rTags = config.revenueTags || [];
    if(list.length === 0){
      tbody.innerHTML=''; table.style.display='none'; empty.style.display='block';
    }else{
      table.style.display=''; empty.style.display='none';
      tbody.innerHTML = list.map(o=>{
        const d = new Date(o.date+'T00:00:00');
        const dateLabel = isNaN(d) ? o.date : (String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear());
        const tagC = ordColor('revenueTags', o.tag), osC = ordColor('orderStatuses', o.orderStatus), isC = ordColor('invoiceStatuses', o.invoiceStatus);
        return `<tr data-id="${o.id}">
          <td>${dateLabel}</td>
          <td class="art-id">${esc(o.invoiceNumber||'-')}</td>
          <td>${esc(o.customerName||'-')}</td>
          <td>${esc(o.platform||'-')}</td>
          <td>${esc(itemsSummary(o.items))}</td>
          <td class="num">${fmt(o.discount)}</td>
          <td class="num" style="font-weight:700;">${fmt(o.net)}</td>
          <td><select class="art-inline-sel" data-field="tag" style="background:${tagC}">${rTags.map(t=>`<option value="${esc(t.name)}" ${t.name===o.tag?'selected':''}>${esc(t.name)}</option>`).join('')}</select></td>
          <td><select class="art-inline-sel" data-field="orderStatus" style="background:${osC}">${oStatuses.map(s=>`<option value="${esc(s.name)}" ${s.name===o.orderStatus?'selected':''}>${esc(s.name)}</option>`).join('')}</select></td>
          <td><select class="art-inline-sel" data-field="invoiceStatus" style="background:${isC}">${iStatuses.map(s=>`<option value="${esc(s.name)}" ${s.name===o.invoiceStatus?'selected':''}>${esc(s.name)}</option>`).join('')}</select></td>
          <td><div class="art-row-actions">
            <button class="acc-icon art-ord-doc" title="${esc(T('doc.rv.title'))}">📄</button>
            <button class="acc-icon art-ord-edit" title="${esc(T('edit'))}">✎</button>
            <button class="acc-icon art-ord-del" title="${esc(T('delete'))}">✕</button>
          </div></td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('tr').forEach(tr=>{
        const id = tr.dataset.id;
        tr.querySelectorAll('.art-inline-sel').forEach(sel=>{
          sel.addEventListener('change', async (e)=>{
            const o = orders.find(x=> x.id===id); if(!o) return;
            o[e.target.dataset.field] = e.target.value;
            await saveOrders();
            renderOrdersTable(body);
          });
        });
        tr.querySelector('.art-ord-doc').addEventListener('click', ()=> openDocMaker(orders.find(o=>o.id===id), body));
        tr.querySelector('.art-ord-edit').addEventListener('click', ()=> openOrderModal(orders.find(o=>o.id===id), body));
        tr.querySelector('.art-ord-del').addEventListener('click', async ()=>{
          if(!window.confirm(T('rev.delConfirm'))) return;
          orders = orders.filter(o=> o.id !== id);
          await saveOrders();
          renderOrdersTable(body);
        });
      });
    }
    body.querySelector('#ordRowCount').textContent = list.length;
    body.querySelector('#ordFootDisc').textContent = fmt(list.reduce((s,o)=> s+(o.discount||0), 0));
    body.querySelector('#ordFootTotal').textContent = fmt(list.reduce((s,o)=> s+o.net, 0));
  }

  /* ================= Financial documents (PDF via print) ================= */
  // Amount → Thai baht words, e.g. 1,250.50 → "หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์".
  function bahtText(amount){
    amount = Math.round((amount + Number.EPSILON) * 100) / 100;
    const nums = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
    const units = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
    function group(n){   // n: 0..999999
      let out = '', s = String(n), len = s.length;
      for(let i = 0; i < len; i++){
        const d = +s[i], pos = len - i - 1;
        if(d === 0) continue;
        if(pos === 1 && d === 1) out += 'สิบ';
        else if(pos === 1 && d === 2) out += 'ยี่สิบ';
        else if(pos === 0 && d === 1 && len > 1) out += 'เอ็ด';
        else out += nums[d] + units[pos];
      }
      return out;
    }
    function conv(n){
      if(n === 0) return 'ศูนย์';
      let out = '';
      const m = Math.floor(n / 1000000), rest = n % 1000000;
      if(m > 0) out += conv(m) + 'ล้าน';
      if(rest > 0) out += group(rest);
      return out;
    }
    const baht = Math.floor(amount), satang = Math.round((amount - baht) * 100);
    if(baht === 0 && satang === 0) return 'ศูนย์บาทถ้วน';
    let text = '';
    if(baht > 0) text += conv(baht) + 'บาท';
    if(satang > 0) text += group(satang) + 'สตางค์';
    else if(baht > 0) text += 'ถ้วน';
    return text;
  }
  // YYYY-MM-DD → "11 กรกฎาคม 2568" (Buddhist year).
  function thaiDate(iso){
    const M = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    const d = new Date(iso + 'T00:00:00');
    if(isNaN(d)) return iso || '-';
    return d.getDate() + ' ' + M[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  }
  function money2(n){ return Number(n||0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 }); }

  // Per-document-type differences. The layout/engine is shared; only labels,
  // number prefix, party wording, signature captions and a statement differ.
  const DOCDEF = {
    rv:      { title:'doc.rv.title', prefix:'RV-', party:'doc.receivedFrom', signL:'doc.payer',        signR:'doc.payee',  showPay:true,  statement:'doc.st.received' },
    bn:      { title:'doc.bn.title', prefix:'BN-', party:'doc.billTo',       signL:'doc.billReceiver', signR:'doc.biller', showPay:false, statement:'doc.st.pleasePay' },
    receipt: { title:'doc.rc.title', prefix:'RE-', party:'doc.receivedFrom', signL:'doc.payer',        signR:'doc.payee',  showPay:true,  statement:'doc.st.received' }
  };

  // Options step: pick document type + VAT + payment method, then generate.
  function openDocMaker(order, body){
    const b = config.business || {};
    let type = 'rv';
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal">
        <h3 class="art-modal-title">${esc(T('doc.makeTitle'))}</h3>
        <p class="setting-desc" style="margin:-4px 0 12px;">${esc(T('doc.optsDesc'))}</p>
        ${(!b.name) ? `<p class="setting-desc" style="color:var(--c-danger);margin-bottom:12px;">${esc(T('doc.noProfile'))}</p>` : ''}
        <div class="doc-type-picker" id="dvType">
          <button type="button" class="doc-type-btn active" data-dtype="rv">${esc(T('doc.rv.title'))}</button>
          <button type="button" class="doc-type-btn" data-dtype="bn">${esc(T('doc.bn.title'))}</button>
          <button type="button" class="doc-type-btn" data-dtype="receipt">${esc(T('doc.rc.title'))}</button>
        </div>
        <div class="sf-inline-toggle" style="padding:8px 0;">
          <span>${esc(T('doc.vat'))}</span>
          <button type="button" class="sf-toggle ${b.vatDefault?'on':'off'}" id="dvVat"><span class="sf-toggle-knob"></span></button>
        </div>
        <label class="art-form-full" id="dvPayWrap" style="display:block;margin-bottom:12px;">${esc(T('doc.payMethod'))}
          <select id="dvPay">
            <option value="cash">${esc(T('doc.pay.cash'))}</option>
            <option value="transfer">${esc(T('doc.pay.transfer'))}</option>
            <option value="other">${esc(T('doc.pay.other'))}</option>
          </select>
        </label>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="dvCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="dvMake">${esc(T('doc.make'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#dvCancel').addEventListener('click', close);
    const payWrap = ov.querySelector('#dvPayWrap');
    ov.querySelectorAll('.doc-type-btn').forEach(btn=> btn.addEventListener('click', ()=>{
      type = btn.dataset.dtype;
      ov.querySelectorAll('.doc-type-btn').forEach(x=> x.classList.toggle('active', x===btn));
      payWrap.style.display = DOCDEF[type].showPay ? 'block' : 'none';   // payment line only where money changed hands
    }));
    const vatBtn = ov.querySelector('#dvVat');
    vatBtn.addEventListener('click', ()=>{
      const on = !vatBtn.classList.contains('on');
      vatBtn.classList.toggle('on', on); vatBtn.classList.toggle('off', !on);
    });
    ov.querySelector('#dvMake').addEventListener('click', ()=>{
      const opts = { type, vat: vatBtn.classList.contains('on'), pay: ov.querySelector('#dvPay').value };
      const html = buildDocumentHtml(order, opts);
      const w = window.open('', '_blank');
      if(!w){ alert(T('doc.popupBlocked')); return; }
      w.document.open(); w.document.write(html); w.document.close();
      close();
    });
  }

  function buildDocumentHtml(order, opts){
    const def = DOCDEF[opts.type] || DOCDEF.rv;
    const b = config.business || {};
    const co = computeOrder(order);
    const grand = co.net;                       // amount actually received
    const vatOn = !!opts.vat;
    const beforeVat = vatOn ? grand * 100 / 107 : grand;
    const vatAmt = vatOn ? grand - beforeVat : 0;
    const docNo = def.prefix + (order.invoiceNumber || String(order.id).slice(-6));
    const payLabel = opts.pay === 'transfer' ? T('doc.pay.transfer') : (opts.pay === 'other' ? T('doc.pay.other') : T('doc.pay.cash'));
    const esc2 = (s)=> esc(String(s == null ? '' : s));
    const nl2br = (s)=> esc2(s).replace(/\n/g, '<br>');

    const rows = (order.items || []).map((it, i)=>{
      const amt = (it.qty || 0) * (it.price || 0);
      const saleNote = it.salePercent ? ` <span style="color:#C6432E;">(ลด ${it.salePercent}%)</span>` : '';
      return '<tr>'+
        '<td class="c">'+(i+1)+'</td>'+
        '<td>'+esc2(it.productName)+saleNote+'</td>'+
        '<td class="c">'+(it.qty||0)+'</td>'+
        '<td class="r">'+money2(it.price)+'</td>'+
        '<td class="r">'+money2(amt)+'</td>'+
      '</tr>';
    }).join('');
    const totalsRows =
      '<tr><td class="tl">'+esc(T('doc.subtotal'))+'</td><td class="r">'+money2(co.itemsTotal)+'</td></tr>'+
      (order.discount ? '<tr><td class="tl">'+esc(T('doc.discount'))+'</td><td class="r">-'+money2(order.discount)+'</td></tr>' : '')+
      (vatOn ? '<tr><td class="tl">'+esc(T('doc.beforeVat'))+'</td><td class="r">'+money2(beforeVat)+'</td></tr><tr><td class="tl">'+esc(T('doc.vat7'))+'</td><td class="r">'+money2(vatAmt)+'</td></tr>' : '')+
      '<tr class="grand"><td class="tl">'+esc(T('doc.grand'))+'</td><td class="r">฿'+money2(grand)+'</td></tr>';

    const logo = b.logo ? '<img class="biz-logo" src="'+esc2(b.logo)+'" alt="">' : '';
    const sign = b.signature ? '<img class="sig-img" src="'+esc2(b.signature)+'" alt="">' : '';
    const stamp = b.stamp ? '<img class="stamp-img" src="'+esc2(b.stamp)+'" alt="">' : '';

    return '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">'+
      '<title>'+esc(T(def.title))+' '+esc2(docNo)+'</title>'+
      '<link rel="preconnect" href="https://fonts.googleapis.com">'+
      '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">'+
      '<style>'+
        '*{box-sizing:border-box;margin:0;padding:0;font-family:Sarabun,sans-serif;}'+
        'body{background:#ececec;color:#1a1a1a;font-size:13px;}'+
        '.toolbar{position:sticky;top:0;background:#2B2E26;color:#fff;padding:10px 16px;display:flex;justify-content:center;gap:10px;}'+
        '.toolbar button{padding:8px 18px;border:none;border-radius:8px;background:#6B7F58;color:#fff;font-size:14px;font-weight:600;cursor:pointer;}'+
        '.page{width:210mm;min-height:297mm;margin:16px auto;background:#fff;padding:18mm 16mm;box-shadow:0 2px 16px rgba(0,0,0,0.15);}'+
        '.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #333;padding-bottom:14px;margin-bottom:18px;}'+
        '.biz{display:flex;gap:12px;align-items:flex-start;max-width:60%;}'+
        '.biz-logo{width:64px;height:64px;object-fit:contain;}'+
        '.biz-name{font-size:18px;font-weight:700;}'+
        '.biz-meta{font-size:12px;color:#444;line-height:1.5;margin-top:2px;}'+
        '.doc-title{text-align:right;}'+
        '.doc-title h1{font-size:22px;font-weight:700;}'+
        '.doc-meta{font-size:12.5px;color:#333;margin-top:6px;line-height:1.6;}'+
        '.party{background:#f6f6f2;border:1px solid #e2e2da;border-radius:8px;padding:12px 14px;margin-bottom:18px;}'+
        '.party .lbl{font-size:12px;color:#666;}'+
        '.party .nm{font-size:15px;font-weight:600;}'+
        '.party .ad{font-size:12.5px;color:#444;line-height:1.5;margin-top:2px;}'+
        'table.items{width:100%;border-collapse:collapse;margin-bottom:14px;}'+
        'table.items th{background:#333;color:#fff;font-size:12.5px;font-weight:600;padding:8px 10px;text-align:left;}'+
        'table.items td{padding:8px 10px;border-bottom:1px solid #eee;font-size:12.5px;}'+
        'table.items .c{text-align:center;}table.items .r{text-align:right;}'+
        '.bottom{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;}'+
        '.words{flex:1;background:#f6f6f2;border:1px dashed #bbb;border-radius:8px;padding:12px 14px;font-size:13px;}'+
        '.words .lbl{font-size:11.5px;color:#666;}'+
        '.words .val{font-weight:700;margin-top:2px;}'+
        '.words .pay{font-size:12px;color:#444;margin-top:8px;}'+
        'table.totals{width:270px;border-collapse:collapse;}'+
        'table.totals td{padding:6px 8px;font-size:12.5px;}'+
        'table.totals .tl{color:#555;}table.totals .r{text-align:right;}'+
        'table.totals tr.grand td{border-top:2px solid #333;font-size:15px;font-weight:700;padding-top:8px;}'+
        '.signs{display:flex;justify-content:space-between;gap:40px;margin-top:48px;}'+
        '.sign-box{flex:1;text-align:center;}'+
        '.sign-space{height:70px;position:relative;display:flex;align-items:flex-end;justify-content:center;}'+
        '.sig-img{max-height:60px;max-width:180px;object-fit:contain;}'+
        '.stamp-img{position:absolute;right:20px;bottom:0;max-height:80px;opacity:0.85;}'+
        '.sign-line{border-top:1px dotted #333;padding-top:6px;font-size:12.5px;color:#333;}'+
        '.note{font-size:11px;color:#888;text-align:center;margin-top:24px;}'+
        '@media print{ body{background:#fff;} .toolbar{display:none;} .page{margin:0;box-shadow:none;width:auto;min-height:auto;padding:14mm;} @page{size:A4;margin:0;} }'+
      '</style></head><body>'+
      '<div class="toolbar"><button onclick="window.print()">🖨️ '+esc(T('doc.print'))+'</button></div>'+
      '<div class="page">'+
        '<div class="head">'+
          '<div class="biz">'+logo+'<div><div class="biz-name">'+(b.name?esc2(b.name):esc(T('doc.yourStore')))+'</div>'+
            '<div class="biz-meta">'+nl2br(b.address)+(b.phone?'<br>โทร. '+esc2(b.phone):'')+(b.taxId?'<br>เลขประจำตัวผู้เสียภาษี '+esc2(b.taxId):'')+'</div></div>'+
          '</div>'+
          '<div class="doc-title"><h1>'+esc(T(def.title))+'</h1>'+
            '<div class="doc-meta">'+esc(T('doc.no'))+' '+esc2(docNo)+'<br>'+esc(T('doc.date'))+' '+esc2(thaiDate(order.date))+'</div></div>'+
        '</div>'+
        '<div class="party"><div class="lbl">'+esc(T(def.party))+'</div>'+
          '<div class="nm">'+esc2(order.customerName || '-')+'</div>'+
          '<div class="ad">'+nl2br(order.address)+(order.invoiceNumber?'<br>'+esc(T('doc.ref'))+' '+esc2(order.invoiceNumber):'')+'</div></div>'+
        '<table class="items"><thead><tr><th class="c" style="width:8%;">'+esc(T('doc.col.no'))+'</th><th>'+esc(T('doc.col.item'))+'</th><th class="c" style="width:10%;">'+esc(T('doc.col.qty'))+'</th><th class="r" style="width:18%;">'+esc(T('doc.col.unit'))+'</th><th class="r" style="width:20%;">'+esc(T('doc.col.amount'))+'</th></tr></thead><tbody>'+
          (rows || '<tr><td colspan="5" class="c" style="color:#999;padding:18px;">-</td></tr>')+
        '</tbody></table>'+
        '<div class="bottom">'+
          '<div class="words"><div class="lbl">'+esc(T('doc.amountWords'))+'</div><div class="val">( '+esc2(bahtText(grand))+' )</div>'+
            '<div class="pay">'+esc(T(def.statement))+'</div>'+
            (def.showPay ? '<div class="pay">'+esc(T('doc.payMethod'))+' : '+esc2(payLabel)+'</div>' : '')+'</div>'+
          '<table class="totals">'+totalsRows+'</table>'+
        '</div>'+
        '<div class="signs">'+
          '<div class="sign-box"><div class="sign-space"></div><div class="sign-line">'+esc(T(def.signL))+'</div></div>'+
          '<div class="sign-box"><div class="sign-space">'+sign+stamp+'</div><div class="sign-line">'+esc(T(def.signR))+(b.name?' · '+esc2(b.name):'')+'</div></div>'+
        '</div>'+
        '<div class="note">'+esc(T('doc.footNote'))+'</div>'+
      '</div></body></html>';
  }

  function openOrderModal(row, body){
    if(!row && products.length === 0){ alert(T('rev.noProducts')); return; }
    ordEditingId = row ? row.id : null;
    const oStatuses = config.orderStatuses || [];
    const iStatuses = config.invoiceStatuses || [];
    const rTags = config.revenueTags || [];
    const today = new Date().toISOString().slice(0,10);
    let items = row ? row.items.map(it=> ({ ...it })) : [{ productName:'', qty:1, price:0 }];

    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <div class="art-modal-head">
          <h3 class="art-modal-title">${esc(row ? T('rev.editTitle') : T('rev.addTitle'))}</h3>
          <div class="art-modal-invoice"><span class="art-modal-invoice-label">${esc(T('rev.invoiceNo'))}</span><span id="ordInvPreview" class="art-modal-invoice-no">-</span></div>
        </div>
        <div class="art-form-grid">
          <label>${esc(T('exp.date'))} <span class="art-req">*</span><input type="date" id="oDate" value="${row?esc(row.date):today}"></label>
          <label>${esc(T('rev.orderStatus'))}<select id="oOs">${oStatuses.map(s=>`<option value="${esc(s.name)}" ${row&&row.orderStatus===s.name?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>
          <label>${esc(T('rev.invoiceStatus'))}<select id="oIs">${iStatuses.map(s=>`<option value="${esc(s.name)}" ${row&&row.invoiceStatus===s.name?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>
          <label>${esc(T('exp.tag'))}<select id="oTag">${rTags.map(t=>`<option value="${esc(t.name)}" ${row&&row.tag===t.name?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label>${esc(T('rev.platform'))}<input type="text" id="oPlatform" value="${row?esc(row.platform||''):''}" placeholder="${esc(T('rev.platformHint'))}"></label>
          <label class="art-form-full">${esc(T('rev.customer'))} <span class="art-req">*</span><input type="text" id="oCustomer" value="${row?esc(row.customerName||''):''}" placeholder="${esc(T('rev.customerHint'))}"></label>
          <label class="art-form-full">${esc(T('rev.address'))} <span class="art-req">*</span><textarea id="oAddress" rows="2" placeholder="${esc(T('rev.addressHint'))}">${row?esc(row.address||''):''}</textarea></label>
        </div>
        <div class="art-items-head">${esc(T('rev.items'))} <span class="art-req">*</span></div>
        <div id="oItems" class="art-items"></div>
        <button type="button" class="btn btn-ghost art-add-item" id="oAddItem">${esc(T('rev.addItem'))}</button>
        <div class="art-form-grid" style="margin-top:14px;">
          <label>${esc(T('exp.discount'))}<input type="number" id="oDisc" value="${row?Math.abs(row.discount||0):0}" step="0.01"></label>
        </div>
        <label class="art-form-note">${esc(T('exp.note'))}<textarea id="oNote" rows="2">${row?esc(row.note||''):''}</textarea></label>
        <div class="art-modal-preview">
          <span>${esc(T('rev.itemsTotal'))}: <b id="oPvItems">0</b></span>
          <span>${esc(T('exp.net'))}: <b id="oPvNet">0</b></span>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="oCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="oSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const g = (id)=> ov.querySelector('#'+id);

    function drawItems(){
      const opts = (id)=> products.map(p=> `<option value="${p.id}" ${p.id===id?'selected':''}>${esc(p.name)}${p.sku?` (${esc(p.sku)})`:''} · ฿${fmt(p.price)}</option>`).join('');
      g('oItems').innerHTML = items.map((it,i)=> `
        <div class="art-item-row" data-i="${i}">
          <select class="art-item-select" data-f="productId">
            <option value="">${esc(T('rev.pickProduct'))}</option>
            ${opts(it.productId)}
          </select>
          <input type="number" class="art-item-qty" data-f="qty" value="${it.qty}" step="1" min="1">
          <input type="number" class="art-item-price" data-f="price" value="${it.price}" step="0.01" placeholder="${esc(T('rev.itemPrice'))}">
          <span class="art-item-sale">${it.salePercent ? '-'+it.salePercent+'%' : ''}</span>
          <button type="button" class="acc-icon art-item-del" ${items.length<=1?'disabled':''}>✕</button>
        </div>`).join('');
      g('oItems').querySelectorAll('.art-item-row').forEach(r=>{
        const i = parseInt(r.dataset.i,10);
        // Product select: pick from catalog → fills productId, name, price.
        r.querySelector('.art-item-select').addEventListener('change', (e)=>{
          const p = products.find(x=> x.id === e.target.value);
          if(p){
            items[i].productId = p.id; items[i].productName = p.name;
            const pct = activePromoPercent(p.id);
            if(pct > 0){
              // Auto-apply the active promotion: fill the discounted unit price and
              // stamp the % on the line so the bill shows a tag. Price stays
              // editable afterward for manual tweaks.
              items[i].salePercent = pct;
              items[i].price = Math.round(p.price * (1 - pct/100) * 100) / 100;
            }else{
              items[i].salePercent = 0;
              items[i].price = p.price;
            }
          }
          else { items[i].productId = null; items[i].productName = ''; items[i].salePercent = 0; }
          drawItems(); updatePreview();
        });
        // qty / price: update state + preview (price stays editable for special deals).
        r.querySelectorAll('[data-f="qty"], [data-f="price"]').forEach(inp=> inp.addEventListener('input', ()=>{
          items[i][inp.dataset.f] = parseFloat(inp.value)||0;
          updatePreview();
        }));
        r.querySelector('.art-item-del').addEventListener('click', ()=>{ if(items.length>1){ items.splice(i,1); drawItems(); updatePreview(); } });
      });
    }
    function updatePreview(){
      const itemsTotal = items.reduce((s,it)=> s+(it.qty*it.price), 0);
      const disc = Math.abs(parseFloat(g('oDisc').value)||0);
      g('oPvItems').textContent = fmt(itemsTotal);
      g('oPvNet').textContent = fmt(itemsTotal - disc);
    }
    function updateInv(){
      const date = g('oDate').value;
      if(!date){ g('ordInvPreview').textContent='-'; return; }
      if(ordEditingId && row && date === row.date){ g('ordInvPreview').textContent = row.invoiceNumber || '-'; }
      else g('ordInvPreview').textContent = generateInvoiceNumber(date, ordEditingId);
    }
    drawItems(); updatePreview(); updateInv();
    g('oAddItem').addEventListener('click', ()=>{ items.push({ productName:'', qty:1, price:0 }); drawItems(); updatePreview(); });
    g('oDisc').addEventListener('input', updatePreview);
    g('oDate').addEventListener('change', updateInv);

    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    g('oCancel').addEventListener('click', close);
    g('oSave').addEventListener('click', async ()=>{
      const date = g('oDate').value;
      const customerName = g('oCustomer').value.trim();
      const address = g('oAddress').value.trim();
      if(!date){ alert(T('exp.errDate')); return; }
      if(!customerName){ alert(T('rev.errCustomer')); return; }
      if(!address){ alert(T('rev.errAddress')); return; }
      const cleanItems = items.filter(it=> it.productId || it.productName.trim());
      if(cleanItems.length === 0){ alert(T('rev.errItems')); return; }
      if(cleanItems.some(it=> !it.productId)){ alert(T('rev.errPickProduct')); return; }
      const data = {
        id: ordEditingId || rid(), date, customerName, address,
        platform: g('oPlatform').value.trim(),
        items: cleanItems,
        discount: Math.abs(parseFloat(g('oDisc').value)||0),
        note: g('oNote').value.trim(),
        tag: g('oTag').value, orderStatus: g('oOs').value, invoiceStatus: g('oIs').value
      };
      if(ordEditingId && row && date === row.date){ data.invoiceNumber = row.invoiceNumber || generateInvoiceNumber(date, ordEditingId); }
      else data.invoiceNumber = generateInvoiceNumber(date, ordEditingId);
      if(ordEditingId) orders = orders.map(o=> o.id===ordEditingId ? data : o);
      else orders.push(data);
      await saveOrders();
      close();
      renderOrdersTable(body);
    });
  }

  /* ================= Products page (PIN-gated) ================= */
  async function saveProducts(){ await window.Store.set(K_PRODUCTS, products); }
  async function saveStockLog(){ await window.Store.set(K_STOCKLOG, stockLog); }
  function prodTagColor(name){ return (PRODUCT_TAGS.find(t=> t.name === name) || {}).color || '#999'; }
  function ptypeColor(name){ return ((config.productTypes||[]).find(t=> t.name === name) || {}).color || '#999'; }
  // Stock accounting for a product across all orders (matched by productId).
  //  reserved  = qty in orders billed but NOT yet paid
  //  sold      = qty in orders whose invoice status reached "paid"
  //  remaining = entered stock minus reserved and sold (real count left)
  function stockOf(prod){
    const paidName = (statusByRole('invoiceStatuses','paid') || {}).name;
    let reserved = 0, sold = 0;
    orders.forEach(o=>{
      const qty = (o.items||[]).filter(it=> it.productId === prod.id).reduce((s,it)=> s+(it.qty||0), 0);
      if(qty === 0) return;
      const isSold = paidName && o.invoiceStatus === paidName;
      if(isSold) sold += qty; else reserved += qty;
    });
    return { reserved, sold, remaining: (prod.stock||0) - reserved - sold };
  }

  function renderProductsPage(body){
    renderProductsContent(body);
  }

  function renderProductsContent(body){
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-spacer"></div>
          <button class="btn btn-ghost" id="prodPromo">${esc(T('promo.btn'))}</button>
          <button class="btn btn-ghost" id="prodRestock">${esc(T('prod.restock'))}</button>
          <button class="btn btn-primary" id="prodAdd">${esc(T('prod.add'))}</button>
        </div>
        <div class="art-table-wrap">
          <table class="art-table" id="prodTable">
            <thead><tr>
              <th>${esc(T('prod.image'))}</th><th>${esc(T('prod.sku'))}</th><th>${esc(T('prod.name'))}</th>
              <th class="num">${esc(T('prod.cost'))}</th><th class="num">${esc(T('prod.price'))}</th>
              <th class="num">${esc(T('prod.sale'))}</th>
              <th class="num">${esc(T('prod.stock'))}</th><th class="num">${esc(T('prod.reserved'))}</th>
              <th class="num">${esc(T('prod.sold'))}</th>
              <th>${esc(T('prod.ptype'))}</th><th>${esc(T('prod.tag'))}</th><th></th></tr></thead>
            <tbody id="prodTbody"></tbody>
          </table>
        </div>
        <div id="prodEmpty" class="art-empty" style="display:none;"><div class="art-empty-ico">🏷️</div>${esc(T('prod.empty'))}</div>
      </div>`;
    body.querySelector('#prodAdd').addEventListener('click', ()=> openProductModal(null, body));
    body.querySelector('#prodRestock').addEventListener('click', ()=> openRestockModal(body));
    body.querySelector('#prodPromo').addEventListener('click', ()=> openPromoManager(body));
    renderProductsTable(body);
  }

  function renderProductsTable(body){
    const tbody = body.querySelector('#prodTbody');
    const table = body.querySelector('#prodTable');
    const empty = body.querySelector('#prodEmpty');
    if(!tbody) return;
    if(products.length === 0){
      tbody.innerHTML=''; table.style.display='none'; empty.style.display='block';
    }else{
      table.style.display=''; empty.style.display='none';
      tbody.innerHTML = products.map(p=>{
        const thumb = p.image ? `<img class="art-prod-thumb" src="${p.image}" alt="">` : `<div class="art-prod-thumb art-prod-noimg">🏷️</div>`;
        const st = stockOf(p);
        const low = st.remaining <= 0;
        const salePct = activePromoPercent(p.id);
        return `<tr data-id="${p.id}">
          <td>${thumb}</td>
          <td class="art-id">${esc(p.sku)}</td>
          <td>${esc(p.name)}</td>
          <td class="num">${fmt(p.cost)}</td>
          <td class="num">${fmt(p.price)}</td>
          <td class="num">${salePct ? `<span class="art-pill" style="background:var(--c-danger)">-${salePct}%</span>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td class="num ${low?'art-neg':''}" style="font-weight:700;">${st.remaining}</td>
          <td class="num art-reserved">${st.reserved || '-'}</td>
          <td class="num art-sold">${st.sold || '-'}</td>
          <td>${p.productType ? `<span class="art-pill" style="background:${ptypeColor(p.productType)}">${esc(p.productType)}</span>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td><span class="art-pill" style="background:${prodTagColor(p.tag)}">${esc(p.tag||'In Stock')}</span></td>
          <td><div class="art-row-actions">
            <button class="acc-icon art-prod-edit" title="${esc(T('edit'))}">✎</button>
            <button class="acc-icon art-prod-del" title="${esc(T('delete'))}">✕</button>
          </div></td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('tr').forEach(tr=>{
        const id = tr.dataset.id;
        tr.querySelector('.art-prod-edit').addEventListener('click', ()=> openProductModal(products.find(p=>p.id===id), body));
        tr.querySelector('.art-prod-del').addEventListener('click', async ()=>{
          if(!window.confirm(T('prod.delConfirm'))) return;
          products = products.filter(p=> p.id !== id);
          await saveProducts();
          renderProductsTable(body);
        });
      });
    }
  }

  function openProductModal(row, body){
    prodEditingId = row ? row.id : null;
    prodImageData = row ? (row.image || null) : null;
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal">
        <h3 class="art-modal-title">${esc(row ? T('prod.editTitle') : T('prod.addTitle'))}</h3>
        <div class="art-form-grid">
          <label>${esc(T('prod.sku'))}<input type="text" id="pSku" value="${row?esc(row.sku):''}"></label>
          <label>${esc(T('prod.tag'))}<select id="pTag">${PRODUCT_TAGS.map(t=>`<option value="${esc(t.name)}" ${row&&row.tag===t.name?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label class="art-form-full">${esc(T('prod.name'))}<input type="text" id="pName" value="${row?esc(row.name):''}"></label>
          <label class="art-form-full">${esc(T('prod.ptype'))} <span class="art-req">*</span><select id="pType"><option value="">${esc(T('prod.pickType'))}</option>${(config.productTypes||[]).map(t=>`<option value="${esc(t.name)}" ${row&&row.productType===t.name?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label>${esc(T('prod.cost'))}<input type="number" id="pCost" value="${row?row.cost:0}" step="0.01"></label>
          <label>${esc(T('prod.price'))}<input type="number" id="pPrice" value="${row?row.price:0}" step="0.01"></label>
          <label>${esc(T('prod.stock'))}<input type="number" id="pStock" value="${row?row.stock:0}" step="1"></label>
        </div>
        <div class="art-img-field">
          <label class="art-img-label">${esc(T('prod.image'))}</label>
          <div class="art-img-preview" id="pImgPreview" style="${prodImageData?'':'display:none;'}">${prodImageData?`<img src="${prodImageData}" alt="">`:''}</div>
          <label class="file-picker">
            <input type="file" id="pImgInput" accept="image/*">
            <span class="file-picker-btn">${esc(T('io.chooseFile'))}</span>
            <span class="file-picker-name" id="pImgName">${esc(T('io.noFile'))}</span>
          </label>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="pCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="pSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const g = (id)=> ov.querySelector('#'+id);
    g('pImgInput').addEventListener('change', (e)=>{
      const file = e.target.files[0]; if(!file) return;
      const nm = ov.querySelector('#pImgName'); if(nm) nm.textContent = file.name;
      const reader = new FileReader();
      reader.onload = ()=>{ prodImageData = reader.result; const pv = g('pImgPreview'); pv.innerHTML = `<img src="${prodImageData}" alt="">`; pv.style.display = 'block'; };
      reader.readAsDataURL(file);
    });
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    g('pCancel').addEventListener('click', close);
    g('pSave').addEventListener('click', async ()=>{
      const sku = g('pSku').value.trim();
      const name = g('pName').value.trim();
      const productType = g('pType').value;
      if(!sku){ alert(T('prod.errSku')); return; }
      if(!name){ alert(T('prod.errName')); return; }
      if(!productType){ alert(T('prod.errType')); return; }
      const data = {
        id: prodEditingId || rid(), sku, name, productType,
        cost: parseFloat(g('pCost').value)||0, price: parseFloat(g('pPrice').value)||0,
        stock: parseInt(g('pStock').value)||0, tag: g('pTag').value, image: prodImageData || null
      };
      if(prodEditingId) products = products.map(p=> p.id===prodEditingId ? data : p);
      else {
        products.push(data);
        // New product's opening stock is logged as a "New Product" entry.
        if(data.stock > 0){
          stockLog.push({ id: rid(), date: new Date().toISOString().slice(0,10), productId: data.id, productName: data.name, productType: data.productType||'', qty: data.stock, signature: '-', type: 'new' });
          await saveStockLog();
        }
      }
      await saveProducts();
      close();
      renderProductsTable(body);
    });
  }

  /* ================= Promotions (manager + editor) ================= */
  function promoStatus(p){
    const today = window.localIso();
    if(p.effectiveDate && p.effectiveDate > today) return 'scheduled';
    if(p.endDate && p.endDate < today) return 'ended';
    return 'active';
  }

  function openPromoManager(body){
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(T('promo.title'))}</h3>
        <p class="setting-desc" style="margin:-4px 0 12px;">${esc(T('promo.desc'))}</p>
        <div id="promoList"></div>
        <button class="btn btn-primary" id="promoNew" style="margin-top:12px;">${esc(T('promo.new'))}</button>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="promoClose">${esc(T('promo.close'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#promoClose').addEventListener('click', close);

    function drawList(){
      const wrap = ov.querySelector('#promoList');
      if(promotions.length === 0){
        wrap.innerHTML = `<div class="art-empty" style="padding:32px;"><div class="art-empty-ico">🏷️</div>${esc(T('promo.empty'))}</div>`;
        return;
      }
      const rank = { active:0, scheduled:1, ended:2 };
      const sorted = promotions.slice().sort((a,b)=> rank[promoStatus(a)] - rank[promoStatus(b)]);
      wrap.innerHTML = sorted.map(p=>{
        const stt = promoStatus(p);
        const cnt = (p.items || []).length;
        return `<div class="art-promo-row" data-id="${p.id}">
          <div class="art-promo-main">
            <div class="art-promo-name">${esc(p.name || T('promo.untitled'))}</div>
            <div class="art-promo-meta">${esc(p.effectiveDate||'-')} → ${esc(p.endDate||'-')} · ${cnt} ${esc(T('promo.itemsUnit'))}</div>
          </div>
          <span class="art-pill art-promo-${stt}">${esc(T('promo.status.'+stt))}</span>
          <div class="art-row-actions">
            <button class="acc-icon art-promo-edit" title="${esc(T('edit'))}">✎</button>
            <button class="acc-icon art-promo-del" title="${esc(T('delete'))}">✕</button>
          </div>
        </div>`;
      }).join('');
      wrap.querySelectorAll('.art-promo-row').forEach(rowEl=>{
        const id = rowEl.dataset.id;
        rowEl.querySelector('.art-promo-edit').addEventListener('click', ()=>{
          openPromoEditor(promotions.find(p=> p.id === id), ()=>{ drawList(); renderProductsTable(body); });
        });
        rowEl.querySelector('.art-promo-del').addEventListener('click', async ()=>{
          if(!window.confirm(T('promo.delConfirm'))) return;
          promotions = promotions.filter(p=> p.id !== id);
          await savePromotions();
          drawList(); renderProductsTable(body);
        });
      });
    }
    ov.querySelector('#promoNew').addEventListener('click', ()=>{
      openPromoEditor(null, ()=>{ drawList(); renderProductsTable(body); });
    });
    drawList();
  }

  function openPromoEditor(promo, onDone){
    const editing = !!promo;
    const today = window.localIso();
    const picked = {};   // productId -> percent (persists across category switches)
    if(promo && Array.isArray(promo.items)) promo.items.forEach(it=>{ picked[it.productId] = it.percent; });
    const cats = (config.productTypes || []).map(t=> t.name);
    let curCat = cats[0] || '';

    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(editing ? T('promo.editTitle') : T('promo.addTitle'))}</h3>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('promo.name'))}<input type="text" id="prName" value="${promo?esc(promo.name||''):''}" placeholder="${esc(T('promo.namePh'))}"></label>
          <label>${esc(T('promo.effDate'))} <span class="art-req">*</span><input type="date" id="prEff" value="${promo?esc(promo.effectiveDate||today):today}"></label>
          <label>${esc(T('promo.endDate'))} <span class="art-req">*</span><input type="date" id="prEnd" value="${promo?esc(promo.endDate||''):''}"></label>
        </div>
        <div class="art-items-head">${esc(T('promo.pickProducts'))} <span class="art-req">*</span></div>
        <div class="art-promo-picker">
          <select id="prCat">${cats.length ? cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('') : `<option value="">${esc(T('promo.noCat'))}</option>`}</select>
          <select id="prProd"></select>
          <button type="button" class="btn btn-ghost" id="prAdd">${esc(T('promo.addItem'))}</button>
        </div>
        <div class="art-promo-count" id="prCount"></div>
        <div id="prPickedList" class="art-promo-picked"></div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="prCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="prSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const g = (id)=> ov.querySelector('#'+id);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    g('prCancel').addEventListener('click', close);

    function updateCount(){
      const n = Object.keys(picked).length;
      g('prCount').textContent = n ? (n + ' ' + T('promo.selected')) : '';
    }
    function nameOf(id){ const p = products.find(x=> x.id === id); return p ? p.name : id; }
    function catOf(id){ const p = products.find(x=> x.id === id); return p ? (p.productType || '') : ''; }
    function skuOf(id){ const p = products.find(x=> x.id === id); return p ? p.sku : ''; }

    // Product dropdown: only items in the chosen category that aren't picked yet.
    function fillProdDropdown(){
      const sel = g('prProd');
      const list = products.filter(p=> p.productType === curCat && picked[p.id] == null);
      sel.innerHTML = list.length === 0
        ? `<option value="">${esc(T('promo.noneLeft'))}</option>`
        : `<option value="">${esc(T('promo.pickProduct'))}</option>` +
          list.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.sku?` (${esc(p.sku)})`:''}</option>`).join('');
      g('prAdd').disabled = list.length === 0;
    }
    // Picked list: what's in the promotion so far, with a per-item % and remove.
    function drawPicked(){
      const wrap = g('prPickedList');
      const ids = Object.keys(picked);
      if(ids.length === 0){
        wrap.innerHTML = `<div class="art-promo-noprod">${esc(T('promo.emptyPicked'))}</div>`;
        updateCount(); return;
      }
      wrap.innerHTML = ids.map(id=>`
        <div class="art-promo-picked-row" data-id="${id}">
          <div class="art-promo-picked-main">
            <span class="art-promo-picked-name">${esc(nameOf(id))}${skuOf(id)?` <span class="art-promo-sku">(${esc(skuOf(id))})</span>`:''}</span>
            <span class="art-promo-picked-cat">${esc(catOf(id))}</span>
          </div>
          <div class="art-promo-pct">
            <input type="number" data-pct="${id}" value="${picked[id]}" step="1" min="0" max="100">
            <span>% off</span>
          </div>
          <button type="button" class="acc-icon art-promo-remove" title="${esc(T('delete'))}">✕</button>
        </div>`).join('');
      wrap.querySelectorAll('[data-pct]').forEach(inp=> inp.addEventListener('input', (e)=>{
        const id = e.target.dataset.pct;
        if(picked[id] != null) picked[id] = Math.min(100, Math.max(0, parseFloat(e.target.value)||0));
      }));
      wrap.querySelectorAll('.art-promo-remove').forEach(btn=> btn.addEventListener('click', (e)=>{
        const id = e.currentTarget.closest('[data-id]').dataset.id;
        delete picked[id];
        drawPicked(); fillProdDropdown();
      }));
      updateCount();
    }
    g('prCat').addEventListener('change', ()=>{ curCat = g('prCat').value; fillProdDropdown(); });
    g('prAdd').addEventListener('click', ()=>{
      const id = g('prProd').value;
      if(!id || picked[id] != null) return;
      picked[id] = 0;   // default 0% — owner sets the discount in the picked list
      drawPicked(); fillProdDropdown();
    });
    fillProdDropdown(); drawPicked();

    g('prSave').addEventListener('click', async ()=>{
      const name = g('prName').value.trim();
      const effectiveDate = g('prEff').value;
      const endDate = g('prEnd').value;
      if(!effectiveDate || !endDate){ alert(T('promo.errDates')); return; }
      if(endDate < effectiveDate){ alert(T('promo.errRange')); return; }
      const items = Object.keys(picked).map(pid=> ({ productId: pid, percent: picked[pid] }));
      if(items.length === 0){ alert(T('promo.errItems')); return; }
      const closed = endDate < today;   // saving with a past end date = already over
      if(editing){
        promo.name = name; promo.effectiveDate = effectiveDate; promo.endDate = endDate; promo.items = items;
        promo.closed = closed; if(!closed) promo.endedAck = false;
        promotions = promotions.map(p=> p.id === promo.id ? promo : p);
      }else{
        promotions.push({ id: rid(), name, effectiveDate, endDate, items, closed, endedAck: false });
      }
      await savePromotions();
      close();
      if(onDone) onDone();
    });
  }

  /* ================= Order Status Kanban ================= */
  let kanbanFilter = { from:'', to:'', tag:'all' };
  // Kanban mode config — orderStatus vs invoiceStatus boards share all logic.
  const KANBAN_MODES = {
    order:   { group:'orderStatuses',   field:'orderStatus',   subPillGroup:'invoiceStatuses', subPillField:'invoiceStatus' },
    invoice: { group:'invoiceStatuses', field:'invoiceStatus', subPillGroup:'orderStatuses',   subPillField:'orderStatus'   }
  };

  function ordersForKanban(mode){
    const m = KANBAN_MODES[mode];
    const completeName = (statusByRole(m.group, mode==='order'?'complete':'paid') || {}).name;
    return orders.filter(o=>{
      if(o[m.field] === completeName) return false; // terminal-status orders leave the board
      if(kanbanFilter.from && o.date < kanbanFilter.from) return false;
      if(kanbanFilter.to && o.date > kanbanFilter.to) return false;
      if(kanbanFilter.tag !== 'all' && o.tag !== kanbanFilter.tag) return false;
      return true;
    });
  }

  function renderOrderKanban(body){ renderKanbanPage(body, 'order'); }
  function renderInvoiceKanban(body){ renderKanbanPage(body, 'invoice'); }

  function renderKanbanPage(body, mode){
    const rTags = config.revenueTags || [];
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="kbFrom" value="${esc(kanbanFilter.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="kbTo" value="${esc(kanbanFilter.to)}"></div>
          <div class="art-field"><label>${esc(T('exp.tag'))}</label>
            <select id="kbTag"><option value="all">${esc(T('exp.all'))}</option>${rTags.map(t=>`<option value="${esc(t.name)}" ${kanbanFilter.tag===t.name?'selected':''}>${esc(t.name)}</option>`).join('')}</select>
          </div>
          <button class="btn btn-ghost" id="kbClear">${esc(T('exp.clearFilter'))}</button>
        </div>
        <div class="art-kanban" id="ordKanban"></div>
      </div>`;
    body.querySelector('#kbFrom').addEventListener('change', e=>{ kanbanFilter.from=e.target.value; drawKanban(body, mode); });
    body.querySelector('#kbTo').addEventListener('change', e=>{ kanbanFilter.to=e.target.value; drawKanban(body, mode); });
    body.querySelector('#kbTag').addEventListener('change', e=>{ kanbanFilter.tag=e.target.value; drawKanban(body, mode); });
    body.querySelector('#kbClear').addEventListener('click', ()=>{ kanbanFilter={from:'',to:'',tag:'all'}; renderKanbanPage(body, mode); });
    drawKanban(body, mode);
  }

  function drawKanban(body, mode){
    const container = body.querySelector('#ordKanban');
    if(!container) return;
    const m = KANBAN_MODES[mode];
    const statuses = config[m.group] || [];
    const terminalRole = mode==='order' ? 'complete' : 'paid';
    const list = ordersForKanban(mode).map(computeOrder);
    container.innerHTML = statuses.map(st=>{
      const isTerminal = st.role === terminalRole;
      const cards = isTerminal ? [] : list.filter(o=> o[m.field] === st.name);
      return `<div class="kcol" data-status="${esc(st.name)}">
        <div class="kcol-head">
          <span class="kcol-dot" style="background:${esc(st.color)}"></span>
          <span>${esc(st.name)}</span>
          <span class="kcol-count">${isTerminal ? '➜' : cards.length}</span>
        </div>
        ${isTerminal ? `<div class="kcol-hint">${esc(T(mode==='order'?'kb.completeHint':'kb.paidHint'))}</div>` : ''}
        <div class="kcol-body">
          ${cards.length===0 && !isTerminal ? `<div class="kcol-empty">${esc(T('kb.empty'))}</div>` : cards.map(o=> kanbanCardHtml(o, m)).join('')}
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.kcard').forEach(el=>{
      el.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('dragging'); });
      el.addEventListener('dragend', ()=> el.classList.remove('dragging'));
      el.querySelector('.kcard-edit').addEventListener('click', (e)=>{ e.stopPropagation(); const o = orders.find(x=>x.id===el.dataset.id); openOrderModal(o, body); });
    });
    container.querySelectorAll('.kcol').forEach(col=>{
      col.addEventListener('dragover', e=>{ e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', ()=> col.classList.remove('drag-over'));
      col.addEventListener('drop', async e=>{
        e.preventDefault(); col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const newStatus = col.dataset.status;
        const o = orders.find(x=> x.id===id);
        if(o && o[m.field] !== newStatus){
          o[m.field] = newStatus;
          await saveOrders();
          drawKanban(body, mode);
        }
      });
    });
  }

  function kanbanCardHtml(o, m){
    const subC = ordColor(m.subPillGroup, o[m.subPillField]);
    return `<div class="kcard" draggable="true" data-id="${o.id}">
      <div class="kcard-actions"><button class="kcard-edit" title="${esc(T('edit'))}">✎</button></div>
      <div class="kcard-inv">${esc(o.invoiceNumber||'-')}</div>
      <div class="kcard-cust">${esc(o.customerName||'-')}</div>
      <div class="kcard-foot">
        <span class="kcard-net">${fmt(o.net)} ฿</span>
        <span class="art-pill" style="background:${subC}; font-size:10px;">${esc(o[m.subPillField])}</span>
      </div>
    </div>`;
  }

  // Restock: add quantity to a product's stock and record who did it.
  function openRestockModal(body){
    if(products.length === 0){ alert(T('rev.noProducts')); return; }
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal">
        <h3 class="art-modal-title">${esc(T('rst.title'))}</h3>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('rst.ptype'))}
            <select id="rsType"><option value="all">${esc(T('rst.allTypes'))}</option>${(config.productTypes||[]).map(t=>`<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}</select>
          </label>
          <label class="art-form-full">${esc(T('rst.product'))} <span class="art-req">*</span>
            <select id="rsProduct"></select>
          </label>
          <label>${esc(T('rst.qty'))} <span class="art-req">*</span><input type="number" id="rsQty" value="1" step="1" min="1"></label>
          <label>${esc(T('rst.date'))}<input type="date" id="rsDate" value="${new Date().toISOString().slice(0,10)}"></label>
          <label class="art-form-full">${esc(T('rst.signature'))} <span class="art-req">*</span><input type="text" id="rsSign" placeholder="${esc(T('rst.signatureHint'))}"></label>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="rsCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="rsSave">${esc(T('rst.confirm'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const g = (id)=> ov.querySelector('#'+id);
    // Fill product dropdown, optionally filtered by the selected type.
    function fillProducts(){
      const type = g('rsType').value;
      const list = type === 'all' ? products : products.filter(p=> p.productType === type);
      g('rsProduct').innerHTML = list.length === 0
        ? `<option value="">${esc(T('rst.noneInType'))}</option>`
        : `<option value="">${esc(T('rev.pickProduct'))}</option>` + list.map(p=>`<option value="${p.id}">${esc(p.name)}${p.sku?` (${esc(p.sku)})`:''} · ${esc(T('prod.stock'))} ${stockOf(p).remaining}</option>`).join('');
    }
    g('rsType').addEventListener('change', fillProducts);
    fillProducts();
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    g('rsCancel').addEventListener('click', close);
    g('rsSave').addEventListener('click', async ()=>{
      const productId = g('rsProduct').value;
      const qty = parseInt(g('rsQty').value)||0;
      const signature = g('rsSign').value.trim();
      const date = g('rsDate').value;
      if(!productId){ alert(T('rev.errPickProduct')); return; }
      if(qty <= 0){ alert(T('rst.errQty')); return; }
      if(!signature){ alert(T('rst.errSign')); return; }
      const prod = products.find(p=> p.id === productId);
      prod.stock = (prod.stock||0) + qty;           // add, never overwrite
      stockLog.push({ id: rid(), date, productId, productName: prod.name, productType: prod.productType||'', qty, signature, type: 'restock' });
      await saveProducts();
      await saveStockLog();
      close();
      renderProductsTable(body);
    });
  }

  /* ================= Stock History ================= */
  let stockHistFilter = { from:'', to:'', product:'all', qtyOp:'any', qtyVal:'', signature:'' };

  function stockHistFiltered(){
    return stockLog.filter(r=>{
      if(stockHistFilter.from && r.date < stockHistFilter.from) return false;
      if(stockHistFilter.to && r.date > stockHistFilter.to) return false;
      if(stockHistFilter.product !== 'all' && r.productId !== stockHistFilter.product) return false;
      if(stockHistFilter.signature && !(r.signature||'').toLowerCase().includes(stockHistFilter.signature.toLowerCase())) return false;
      if(stockHistFilter.qtyOp !== 'any' && stockHistFilter.qtyVal !== ''){
        const v = parseFloat(stockHistFilter.qtyVal);
        if(stockHistFilter.qtyOp === 'gt' && !(r.qty > v)) return false;
        if(stockHistFilter.qtyOp === 'lt' && !(r.qty < v)) return false;
        if(stockHistFilter.qtyOp === 'eq' && !(r.qty === v)) return false;
      }
      return true;
    }).sort((a,b)=> b.date.localeCompare(a.date));
  }

  function renderStockHistory(body){
    const f = stockHistFilter;
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="shFrom" value="${esc(f.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="shTo" value="${esc(f.to)}"></div>
          <div class="art-field"><label>${esc(T('sh.product'))}</label>
            <select id="shProduct"><option value="all">${esc(T('exp.all'))}</option>${products.map(p=>`<option value="${p.id}" ${f.product===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('sh.qty'))}</label>
            <select id="shQtyOp">
              <option value="any" ${f.qtyOp==='any'?'selected':''}>${esc(T('sh.any'))}</option>
              <option value="gt" ${f.qtyOp==='gt'?'selected':''}>${esc(T('sh.gt'))}</option>
              <option value="lt" ${f.qtyOp==='lt'?'selected':''}>${esc(T('sh.lt'))}</option>
              <option value="eq" ${f.qtyOp==='eq'?'selected':''}>${esc(T('sh.eq'))}</option>
            </select>
          </div>
          <div class="art-field"><label>&nbsp;</label><input type="number" id="shQtyVal" value="${esc(f.qtyVal)}" placeholder="${esc(T('sh.qtyVal'))}" style="width:90px;" ${f.qtyOp==='any'?'disabled':''}></div>
          <div class="art-field"><label>${esc(T('sh.signature'))}</label><input type="text" id="shSign" value="${esc(f.signature)}" placeholder="${esc(T('sh.signHint'))}"></div>
          <button class="btn btn-ghost" id="shClear">${esc(T('exp.clearFilter'))}</button>
        </div>
        <div class="art-table-wrap">
          <table class="art-table" id="shTable">
            <thead><tr>
              <th>${esc(T('rst.date'))}</th><th>${esc(T('sh.action'))}</th><th>${esc(T('sh.product'))}</th>
              <th>${esc(T('sh.ptype'))}</th><th class="num">${esc(T('sh.qtyAdded'))}</th><th>${esc(T('sh.signature'))}</th>
            </tr></thead>
            <tbody id="shTbody"></tbody>
            <tfoot><tr><td colspan="4">${esc(T('sh.totalRows'))} (<span id="shCount">0</span>)</td><td class="num" id="shTotal">0</td><td></td></tr></tfoot>
          </table>
        </div>
        <div id="shEmpty" class="art-empty" style="display:none;"><div class="art-empty-ico">📦</div>${esc(T('sh.empty'))}</div>
      </div>`;
    const re = ()=> renderStockHistTable(body);
    body.querySelector('#shFrom').addEventListener('change', e=>{ f.from=e.target.value; re(); });
    body.querySelector('#shTo').addEventListener('change', e=>{ f.to=e.target.value; re(); });
    body.querySelector('#shProduct').addEventListener('change', e=>{ f.product=e.target.value; re(); });
    body.querySelector('#shQtyOp').addEventListener('change', e=>{ f.qtyOp=e.target.value; renderStockHistory(body); });
    body.querySelector('#shQtyVal').addEventListener('input', e=>{ f.qtyVal=e.target.value; re(); });
    body.querySelector('#shSign').addEventListener('input', e=>{ f.signature=e.target.value; re(); });
    body.querySelector('#shClear').addEventListener('click', ()=>{ stockHistFilter={from:'',to:'',product:'all',qtyOp:'any',qtyVal:'',signature:''}; renderStockHistory(body); });
    renderStockHistTable(body);
  }

  function renderStockHistTable(body){
    const list = stockHistFiltered();
    const tbody = body.querySelector('#shTbody');
    const table = body.querySelector('#shTable');
    const empty = body.querySelector('#shEmpty');
    if(!tbody) return;
    if(list.length === 0){
      tbody.innerHTML=''; table.style.display='none'; empty.style.display='block';
    }else{
      table.style.display=''; empty.style.display='none';
      tbody.innerHTML = list.map(r=>{
        const d = new Date(r.date+'T00:00:00');
        const dateLabel = isNaN(d) ? r.date : (String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear());
        return `<tr>
          <td>${dateLabel}</td>
          <td><span class="art-pill" style="background:${r.type==='new'?'#6B8F71':'#C97B4E'}">${esc(r.type==='new'?T('sh.typeNew'):T('sh.typeRestock'))}</span></td>
          <td>${esc(r.productName)}</td>
          <td>${r.productType ? `<span class="art-pill" style="background:${ptypeColor(r.productType)}">${esc(r.productType)}</span>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td class="num art-sold" style="font-weight:700;">+${r.qty}</td>
          <td>${esc(r.signature)}</td>
        </tr>`;
      }).join('');
    }
    body.querySelector('#shCount').textContent = list.length;
    body.querySelector('#shTotal').textContent = '+' + list.reduce((s,r)=> s+r.qty, 0);
  }

  /* ================= Setting page ================= */
  // Four editable groups — expense tags, revenue tags, order statuses,
  // invoice statuses — each a list of {id,name,color} the user can
  // add / rename / recolour / delete, mirroring the Base App's room editor.
  function renderSettingPage(body){
    body.innerHTML = `
      <div class="panel settings-panel">
        <h3 class="setting-title">${esc(T('set.title'))}</h3>
        <p class="setting-desc">${esc(T('set.desc'))}</p>
        <div id="artSetGroups"></div>
      </div>`;
    const host = body.querySelector('#artSetGroups');
    host.innerHTML =
      businessProfileHtml() +
      groupHtml('expenseTags',     T('set.expenseTags')) +
      groupHtml('revenueTags',     T('set.revenueTags')) +
      groupHtml('productTypes',    T('set.productTypes')) +
      groupHtml('orderStatuses',   T('set.orderStatuses')) +
      groupHtml('invoiceStatuses', T('set.invoiceStatuses')) +
      broughtFromHtml() +
      prefixHtml();
    wireBusinessProfile(host, body);
    wireGroups(host, body);
    wireBroughtFrom(host, body);
    wirePrefix(host);
  }

  /* ---- Business Profile (issuer info for financial documents) ---- */
  function businessProfileHtml(){
    const b = config.business || {};
    const imgField = (key, label)=>{
      const src = b[key] || '';
      return `<div class="art-img-field">
        <label class="art-img-label">${esc(label)}</label>
        <div class="art-img-preview" style="${src?'':'display:none;'}">${src?`<img src="${esc(src)}" alt="">`:''}</div>
        <label class="file-picker">
          <input type="file" accept="image/*" data-bpfile="${key}">
          <span class="file-picker-btn">${esc(T('io.chooseFile'))}</span>
        </label>
        ${src?`<button type="button" class="acc-icon art-bp-clear" data-bpclear="${key}" title="${esc(T('bp.remove'))}">✕</button>`:''}
      </div>`;
    };
    return `
      <div class="settings-section art-bp-section">
        <div class="settings-section-head">
          <h3 class="setting-title">${esc(T('bp.title'))}</h3>
          <p class="setting-desc">${esc(T('bp.desc'))}</p>
        </div>
        <div class="art-bp-grid">
          <label class="art-bp-full">${esc(T('bp.name'))}<input type="text" id="bpName" value="${esc(b.name||'')}"></label>
          <label class="art-bp-full">${esc(T('bp.address'))}<textarea id="bpAddress" rows="2">${esc(b.address||'')}</textarea></label>
          <label>${esc(T('bp.phone'))}<input type="text" id="bpPhone" value="${esc(b.phone||'')}"></label>
          <label>${esc(T('bp.taxId'))}<input type="text" id="bpTaxId" value="${esc(b.taxId||'')}"></label>
        </div>
        <div class="art-bp-imgs">
          ${imgField('logo', T('bp.logo'))}
          ${imgField('signature', T('bp.signature'))}
          ${imgField('stamp', T('bp.stamp'))}
        </div>
        <div class="sf-inline-toggle" style="margin-top:14px;">
          <span>${esc(T('bp.vatDefault'))}</span>
          <button type="button" class="sf-toggle ${b.vatDefault?'on':'off'}" id="bpVat"><span class="sf-toggle-knob"></span></button>
        </div>
      </div>`;
  }
  function wireBusinessProfile(host, body){
    const b = config.business;
    const bind = (id, key)=>{ const el = host.querySelector('#'+id); if(el) el.addEventListener('input', async ()=>{ b[key] = el.value; await saveConfig(); }); };
    bind('bpName','name'); bind('bpAddress','address'); bind('bpPhone','phone'); bind('bpTaxId','taxId');
    const vat = host.querySelector('#bpVat');
    if(vat) vat.addEventListener('click', async ()=>{
      b.vatDefault = !b.vatDefault;
      vat.classList.toggle('on', b.vatDefault); vat.classList.toggle('off', !b.vatDefault);
      await saveConfig();
    });
    host.querySelectorAll('[data-bpfile]').forEach(inp=> inp.addEventListener('change', (e)=>{
      const key = inp.dataset.bpfile, file = e.target.files[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = async ()=>{ b[key] = reader.result; await saveConfig(); renderSettingPage(body); };
      reader.readAsDataURL(file);
    }));
    host.querySelectorAll('[data-bpclear]').forEach(btn=> btn.addEventListener('click', async ()=>{
      b[btn.dataset.bpclear] = ''; await saveConfig(); renderSettingPage(body);
    }));
  }

  // Brought-From list (no colour) — where an expense was purchased.
  function broughtFromHtml(){
    const items = config.broughtFrom || [];
    const rows = items.map(it=> `
      <div class="art-set-row" data-bf="${it.id}">
        <input type="text" class="art-set-name" data-field="name" value="${esc(it.name)}">
        <button type="button" class="acc-icon art-bf-del" title="${esc(T('delete'))}">✕</button>
      </div>`).join('') || `<p class="art-set-empty">${esc(T('set.none'))}</p>`;
    return `
      <div class="art-set-group" data-bfgroup="1">
        <div class="art-set-group-head">
          <h4 class="diary-section-title">${esc(T('set.broughtFrom'))}</h4>
          <button type="button" class="btn btn-ghost art-bf-add">${esc(T('set.add'))}</button>
        </div>
        <div class="art-set-list">${rows}</div>
      </div>`;
  }

  // ID prefix editors (max 4 chars each).
  function prefixHtml(){
    const p = config.prefixes || { expense:'CSA', order:'ATSC' };
    return `
      <div class="art-set-group">
        <h4 class="diary-section-title">${esc(T('set.prefixTitle'))}</h4>
        <p class="setting-desc" style="margin:4px 0 12px;">${esc(T('set.prefixDesc'))}</p>
        <div class="art-prefix-row">
          <label class="art-prefix-field">${esc(T('set.prefixExpense'))}<input type="text" id="pfExpense" maxlength="4" value="${esc(p.expense)}"></label>
          <label class="art-prefix-field">${esc(T('set.prefixOrder'))}<input type="text" id="pfOrder" maxlength="4" value="${esc(p.order)}"></label>
        </div>
      </div>`;
  }

  function wireBroughtFrom(host, body){
    const group = host.querySelector('[data-bfgroup]');
    if(!group) return;
    group.querySelector('.art-bf-add').addEventListener('click', async ()=>{
      config.broughtFrom.push({ id: rid(), name: T('set.newItem') });
      await saveConfig(); renderSettingPage(body);
    });
    group.querySelectorAll('[data-bf]').forEach(rowEl=>{
      const id = rowEl.dataset.bf;
      const item = config.broughtFrom.find(x=> x.id === id);
      rowEl.querySelector('[data-field="name"]').addEventListener('change', async (e)=>{
        item.name = e.target.value.trim() || item.name; await saveConfig();
      });
      rowEl.querySelector('.art-bf-del').addEventListener('click', async ()=>{
        if(!window.confirm(T('set.delConfirm'))) return;
        config.broughtFrom = config.broughtFrom.filter(x=> x.id !== id);
        await saveConfig(); renderSettingPage(body);
      });
    });
  }

  function wirePrefix(host){
    const exp = host.querySelector('#pfExpense'), ord = host.querySelector('#pfOrder');
    if(!exp || !ord) return;
    const clean = (v)=> v.trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
    exp.addEventListener('change', async ()=>{ config.prefixes.expense = clean(exp.value) || 'CSA'; exp.value = config.prefixes.expense; await saveConfig(); });
    ord.addEventListener('change', async ()=>{ config.prefixes.order = clean(ord.value) || 'ATSC'; ord.value = config.prefixes.order; await saveConfig(); });
  }

  function groupHtml(groupKey, label){
    const items = config[groupKey] || [];
    const rows = items.map(it=> `
      <div class="art-set-row" data-item="${it.id}">
        <span class="art-set-swatch" style="background:${esc(it.color)}"></span>
        <input type="text" class="art-set-name" data-field="name" value="${esc(it.name)}">
        ${it.locked ? `<span class="art-set-lock" title="${esc(T('set.lockedHint'))}">🔒</span>` : ''}
        <input type="color" class="art-set-color" data-field="color" value="${esc(it.color)}">
        ${it.locked ? `<span class="art-set-del-placeholder"></span>` : `<button type="button" class="acc-icon art-set-del" title="${esc(T('delete'))}">✕</button>`}
      </div>`).join('') || `<p class="art-set-empty">${esc(T('set.none'))}</p>`;
    return `
      <div class="art-set-group" data-group="${groupKey}">
        <div class="art-set-group-head">
          <h4 class="diary-section-title">${esc(label)}</h4>
          <button type="button" class="btn btn-ghost art-set-add">${esc(T('set.add'))}</button>
        </div>
        <div class="art-set-list">${rows}</div>
      </div>`;
  }

  function wireGroups(host, body){
    host.querySelectorAll('.art-set-group[data-group]').forEach(groupEl=>{
      const groupKey = groupEl.dataset.group;

      // Add
      groupEl.querySelector('.art-set-add').addEventListener('click', async ()=>{
        config[groupKey].push({ id: rid(), name: T('set.newItem'), color: '#FDBD31' });
        await saveConfig();
        renderSettingPage(body);
      });

      // Per-row: rename, recolour, delete
      groupEl.querySelectorAll('.art-set-row').forEach(rowEl=>{
        const id = rowEl.dataset.item;
        const item = config[groupKey].find(x=> x.id === id);
        if(!item) return;

        rowEl.querySelector('[data-field="name"]').addEventListener('change', async (e)=>{
          item.name = e.target.value.trim() || item.name;
          await saveConfig();
        });
        rowEl.querySelector('[data-field="color"]').addEventListener('input', async (e)=>{
          item.color = e.target.value;
          rowEl.querySelector('.art-set-swatch').style.background = e.target.value;
          await saveConfig();
        });
        const delBtn = rowEl.querySelector('.art-set-del');
        if(delBtn) delBtn.addEventListener('click', async ()=>{
          if(!window.confirm(T('set.delConfirm'))) return;
          config[groupKey] = config[groupKey].filter(x=> x.id !== id);
          await saveConfig();
          renderSettingPage(body);
        });
      });
    });
  }

  /* ---- Helpers other sub-pages will use (exported within module scope) ---- */
  // Colour lookup by name across a config group (used by tables/kanban later).
  function colorOf(groupKey, name){
    const it = (config[groupKey] || []).find(x=> x.name === name);
    return it ? it.color : '#999';
  }

  /* ================= i18n ================= */
  window.registerModuleI18n(ID, {
    th: {
      'title': 'ระบบจัดการร้านค้า', 'crumb': 'ระบบจัดการร้านค้า',
      'soon': 'กำลังพัฒนาส่วนนี้…',
      'delete': 'ลบ', 'edit': 'แก้ไข', 'save': 'บันทึก', 'cancel': 'ยกเลิก',
      'exp.from': 'จากวันที่', 'exp.to': 'ถึงวันที่', 'exp.tag': 'Tag', 'exp.all': 'ทั้งหมด',
      'exp.clearFilter': 'ล้างตัวกรอง', 'exp.add': '+ เพิ่มรายการ', 'exp.addTitle': 'เพิ่มรายการรายจ่าย', 'exp.editTitle': 'แก้ไขรายการรายจ่าย',
      'exp.id': 'รหัส', 'exp.date': 'วันที่', 'exp.details': 'รายการ', 'exp.costPerPiece': 'ต้นทุน/ชิ้น', 'exp.amount': 'จำนวน',
      'exp.sumItems': 'รวมสินค้า', 'exp.shipping': 'ค่าส่ง', 'exp.discount': 'ส่วนลด', 'exp.net': 'สุทธิ',
      'exp.purchaseFrom': 'ร้าน/ที่ซื้อ', 'exp.pickFrom': '— เลือกแหล่งที่ซื้อ —', 'exp.note': 'หมายเหตุ', 'exp.totalRows': 'รวม', 'exp.empty': 'ยังไม่มีรายการรายจ่าย เริ่มเพิ่มรายการแรกได้เลย',
      'exp.delConfirm': 'ลบรายการนี้?',
      'sum.period': 'ช่วงเวลา', 'sum.allTime': 'ทั้งหมด', 'sum.tag': 'Tag', 'sum.netTotal': 'ยอดสุทธิ', 'sum.percent': '% ของยอดรวม',
      'sum.sum': 'รวม', 'sum.totalNet': 'รวมรายจ่าย (สุทธิ)', 'sum.count': 'จำนวนรายการ', 'sum.avg': 'เฉลี่ยต่อรายการ', 'sum.noData': 'ยังไม่มีข้อมูลในช่วงนี้',
      'rev.add': '+ เพิ่มออเดอร์', 'rev.addTitle': 'เพิ่มออเดอร์', 'rev.editTitle': 'แก้ไขออเดอร์',
      'rev.invoiceNo': 'เลขบิล', 'rev.customer': 'ชื่อผู้รับ', 'rev.customerHint': 'ชื่อ-นามสกุลผู้รับ', 'rev.address': 'ที่อยู่ผู้รับ', 'rev.addressHint': 'ที่อยู่สำหรับจัดส่ง', 'rev.platform': 'ขายผ่าน Platform', 'rev.platformHint': 'เช่น TikTok Shop', 'rev.items': 'รายการสินค้า',
      'rev.orderStatus': 'สถานะออเดอร์', 'rev.invoiceStatus': 'สถานะใบเสร็จ', 'rev.totalRows': 'รวม',
      'rev.empty': 'ยังไม่มีออเดอร์ เริ่มเพิ่มออเดอร์แรกได้เลย', 'rev.delConfirm': 'ลบออเดอร์นี้?',
      'rev.addItem': '+ เพิ่มสินค้า', 'rev.itemName': 'ชื่อสินค้า', 'rev.itemPrice': 'ราคา', 'rev.itemsTotal': 'รวมสินค้า',
      'rev.errCustomer': 'กรุณากรอกชื่อผู้รับ', 'rev.errAddress': 'กรุณากรอกที่อยู่ผู้รับ', 'rev.errItems': 'กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'rev.errPickProduct': 'กรุณาเลือกสินค้าจากรายการที่มีเท่านั้น', 'rev.pickProduct': '— เลือกสินค้า —', 'rev.noProducts': 'ยังไม่มีสินค้าในระบบ กรุณาเพิ่มสินค้าในหน้าจัดการสินค้าก่อนนะคะ',
      'prod.pinTitle': 'หน้านี้ต้องใส่ PIN', 'prod.pinDesc': 'กรอกรหัส PIN 6 หลักเพื่อจัดการสินค้า', 'prod.pinWrong': 'PIN ไม่ถูกต้องค่ะ ลองใหม่อีกครั้ง', 'prod.pinClear': 'ล้าง',
      'prod.restock': '+ เติมสต๊อก', 'prod.add': '+ เพิ่มสินค้า',
      'rst.title': 'เติมสต๊อกสินค้า', 'rst.ptype': 'หมวดหมู่', 'rst.allTypes': 'ทั้งหมด', 'rst.noneInType': 'ไม่มีสินค้าในหมวดหมู่นี้', 'rst.product': 'สินค้า', 'rst.qty': 'จำนวนที่เติม', 'rst.date': 'วันที่', 'rst.signature': 'ผู้เติม (Signature)', 'rst.signatureHint': 'พิมพ์ชื่อคุณ', 'rst.confirm': 'ยืนยันเติมสต๊อก',
      'rst.errQty': 'จำนวนต้องมากกว่า 0', 'rst.errSign': 'กรุณาพิมพ์ชื่อผู้เติม',
      'sh.product': 'สินค้า', 'sh.action': 'Action', 'sh.ptype': 'หมวดหมู่', 'sh.type': 'ประเภท', 'sh.typeRestock': 'เติมสต๊อก', 'sh.typeNew': 'สินค้าใหม่', 'sh.qty': 'จำนวน', 'sh.any': 'ทั้งหมด', 'sh.gt': 'มากกว่า', 'sh.lt': 'น้อยกว่า', 'sh.eq': 'เท่ากับ', 'sh.qtyVal': 'จำนวน',
      'sh.signature': 'ผู้เติม', 'sh.signHint': 'ค้นชื่อ', 'sh.qtyAdded': 'จำนวนที่เติม', 'sh.totalRows': 'รวม', 'sh.empty': 'ยังไม่มีประวัติการเติมสต๊อก',
      'io.exportTitle': 'ส่งออกข้อมูล Simple Store', 'io.exportDesc': 'ดาวน์โหลดข้อมูลทั้งหมด (รายจ่าย/ออเดอร์/สินค้า/ตั้งค่า/ประวัติสต๊อก) เป็นไฟล์ JSON — ไฟล์เดียวกู้กลับได้ครบ',
      'io.json': 'ดาวน์โหลด JSON (สำรองทั้งหมด)', 'io.importTitle': 'นำเข้าข้อมูล Simple Store', 'io.importDesc': 'อัปโหลดไฟล์ JSON ที่สำรองไว้ — จะแทนที่ข้อมูล Simple Store ทั้งหมด (ไม่ใช่การรวม)',
      'io.chooseFile': 'เลือกไฟล์', 'io.noFile': 'ยังไม่ได้เลือกไฟล์', 'io.importBtn': 'นำเข้า',
      'io.replaceWarn': 'การนำเข้าจะแทนที่ข้อมูล Simple Store ทั้งหมด (ปัจจุบันมี {n} รายการ) — ยืนยันหรือไม่?',
      'io.importDone': 'นำเข้าสำเร็จ', 'io.importFail': 'นำเข้าล้มเหลว — ไฟล์ไม่ถูกต้อง',
      'io.csvExportLabel': 'หรือส่งออกทีละตารางเป็น CSV (เปิดด้วย Excel ได้):', 'io.csvExp': 'CSV รายจ่าย', 'io.csvOrd': 'CSV ออเดอร์', 'io.csvProd': 'CSV สินค้า',
      'io.importNote': '⚠️ นำเข้า CSV ได้เฉพาะ รายจ่าย และ สินค้า เท่านั้น (รหัสใหม่=สร้าง · รหัสเดิม=แก้ไข · ใส่ delete ในคอลัมน์ action=ลบ) — ส่วนออเดอร์นำเข้าได้เฉพาะไฟล์ JSON (เพราะรายการสินค้าผูกกับรหัสสินค้า)',
      'io.csvDone': 'นำเข้า {t} สำเร็จ — สร้าง {c} · แก้ไข {u} · ลบ {d}', 'io.tbl_expenses': 'รายจ่าย', 'io.tbl_products': 'สินค้า', 'prod.addTitle': 'เพิ่มสินค้า', 'prod.editTitle': 'แก้ไขสินค้า',
      'prod.image': 'รูป', 'prod.sku': 'รหัสสินค้า', 'prod.name': 'ชื่อสินค้า', 'prod.cost': 'ต้นทุน', 'prod.price': 'ราคาขาย',
      'prod.sale': 'ลดราคา',
      'promo.btn': 'Promotion', 'promo.navLabel': 'โปรโมชัน',
      'promo.title': 'จัดการโปรโมชัน', 'promo.desc': 'ตั้งช่วงลดราคาตามหมวดหมู่/สินค้า · สินค้าจะลดอัตโนมัติเมื่อถึงช่วงเวลา และหยุดเองเมื่อพ้นวันสิ้นสุด (ตรวจตอนเปิดแอป)',
      'promo.new': '+ สร้างโปรโมชัน', 'promo.empty': 'ยังไม่มีโปรโมชัน', 'promo.close': 'ปิด',
      'promo.untitled': '(ไม่มีชื่อ)', 'promo.itemsUnit': 'รายการ', 'promo.selected': 'ที่เลือก',
      'promo.status.active': 'กำลังลด', 'promo.status.scheduled': 'ตั้งเวลาไว้', 'promo.status.ended': 'สิ้นสุดแล้ว',
      'promo.addTitle': 'สร้างโปรโมชัน', 'promo.editTitle': 'แก้ไขโปรโมชัน',
      'promo.name': 'ชื่อโปรโมชัน', 'promo.namePh': 'เช่น โปร 11.11, ลดหน้าร้อน',
      'promo.effDate': 'วันเริ่ม (Effective)', 'promo.endDate': 'วันสิ้นสุด (End)',
      'promo.pickProducts': 'เลือกสินค้าที่จะลด', 'promo.category': 'หมวดหมู่', 'promo.noCat': '— ไม่มีหมวดหมู่ —',
      'promo.addItem': 'เลือกชิ้นนี้', 'promo.pickProduct': '— เลือกสินค้า —', 'promo.noneLeft': 'ไม่มีสินค้าเหลือในหมวดนี้', 'promo.emptyPicked': 'ยังไม่ได้เลือกสินค้า',
      'promo.noProdInCat': 'ไม่มีสินค้าในหมวดนี้', 'promo.delConfirm': 'ลบโปรโมชันนี้ใช่ไหมคะ?',
      'promo.errDates': 'กรุณาใส่วันเริ่มและวันสิ้นสุด', 'promo.errRange': 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', 'promo.errItems': 'กรุณาเลือกสินค้าอย่างน้อย 1 ชิ้น',
      'promo.endedTitle': 'โปรโมชันสิ้นสุดแล้ว', 'promo.endedOn': 'สิ้นสุด',
      'prod.stock': 'สต๊อก', 'prod.reserved': 'จองแล้ว', 'prod.sold': 'ขายแล้ว', 'prod.ptype': 'หมวดหมู่', 'prod.pickType': '— เลือกหมวดหมู่ —', 'prod.errType': 'กรุณาเลือกหมวดหมู่', 'prod.tag': 'สถานะ', 'prod.empty': 'ยังไม่มีสินค้าในระบบ เริ่มเพิ่มสินค้าแรกได้เลย',
      'prod.delConfirm': 'ลบสินค้านี้? (ออเดอร์เก่าจะยังเก็บชื่อ/ราคาไว้ตามเดิม)', 'prod.errSku': 'กรุณากรอกรหัสสินค้า', 'prod.errName': 'กรุณากรอกชื่อสินค้า', 'exp.errDetails': 'กรุณากรอกรายละเอียดรายการ', 'exp.errDate': 'กรุณาเลือกวันที่', 'exp.errAmount': 'จำนวนต้องมากกว่า 0',
      'nav.expense': 'รายจ่าย', 'nav.summary': 'สรุปต้นทุน', 'nav.revenue': 'รายรับ/ออกบิล',
      'nav.orderStatus': 'สถานะออเดอร์', 'nav.invoiceStatus': 'สถานะใบเสร็จ',
      'nav.products': 'จัดการสินค้า', 'nav.stockHistory': 'ประวัติเติมสต๊อก', 'nav.setting': 'ตั้งค่า',
      'set.title': 'ตั้งค่า', 'set.desc': 'จัดการหัวข้อและสีของ Tag และสถานะต่าง ๆ — เพิ่ม แก้ไข เปลี่ยนสี หรือลบได้',
      'set.expenseTags': 'Tag รายจ่าย', 'set.revenueTags': 'Tag รายรับ/ออกบิล',
      'set.orderStatuses': 'สถานะออเดอร์', 'set.invoiceStatuses': 'สถานะใบเสร็จ',
      'set.add': '+ เพิ่ม', 'set.none': 'ยังไม่มีรายการ', 'set.newItem': 'รายการใหม่',
      'set.delConfirm': 'ลบรายการนี้?', 'set.lockedHint': 'สถานะนี้ใช้ตัดสต๊อก แก้ชื่อ/สีได้ แต่ลบไม่ได้',
      'set.broughtFrom': 'แหล่งที่ซื้อ (Brought From)', 'set.productTypes': 'หมวดหมู่สินค้า', 'set.prefixTitle': 'รหัสนำหน้า ID', 'set.prefixDesc': 'กำหนดตัวอักษรนำหน้ารหัส (ไม่เกิน 4 ตัว) สำหรับรายจ่ายและออเดอร์',
      'set.prefixExpense': 'นำหน้ารหัสรายจ่าย', 'set.prefixOrder': 'นำหน้าเลขบิลออเดอร์',
      'kb.empty': 'ไม่มีออเดอร์', 'kb.completeHint': 'ลากออเดอร์มาที่นี่ → ย้ายไปหน้า Completed อัตโนมัติ', 'kb.paidHint': 'ลากออเดอร์มาที่นี่ → ทำเครื่องหมายจ่ายครบ (ตัดสต๊อกเป็น Sold)',
      'bp.title': 'ข้อมูลร้าน (สำหรับออกเอกสาร)', 'bp.desc': 'ใช้เป็นหัวเอกสารการเงินทุกใบ (ใบสำคัญรับเงิน ฯลฯ)',
      'bp.name': 'ชื่อร้าน / ผู้ประกอบการ', 'bp.address': 'ที่อยู่', 'bp.phone': 'เบอร์ติดต่อ', 'bp.taxId': 'เลขประจำตัวผู้เสียภาษี (ถ้ามี)',
      'bp.logo': 'โลโก้', 'bp.signature': 'ลายเซ็น', 'bp.stamp': 'ตราประทับ', 'bp.vatDefault': 'ค่าเริ่มต้น: คำนวณ VAT 7%', 'bp.remove': 'ลบรูป',
      'doc.rv.title': 'ใบสำคัญรับเงิน', 'doc.optsDesc': 'เลือกตัวเลือกก่อนออกเอกสาร แล้วสั่งพิมพ์/บันทึกเป็น PDF',
      'doc.bn.title': 'ใบวางบิล', 'doc.rc.title': 'ใบเสร็จรับเงิน', 'doc.makeTitle': 'ออกเอกสาร',
      'doc.billTo': 'วางบิลถึง', 'doc.biller': 'ลงชื่อผู้วางบิล', 'doc.billReceiver': 'ลงชื่อผู้รับวางบิล',
      'doc.st.received': 'ได้รับเงินไว้เป็นการถูกต้องเรียบร้อยแล้ว', 'doc.st.pleasePay': 'กรุณาชำระเงินตามยอดรวมข้างต้น',
      'doc.noProfile': '⚠ ยังไม่ได้กรอกข้อมูลร้านในหน้า Setting เอกสารจะไม่มีหัวร้าน', 'doc.vat': 'คำนวณ VAT 7% (ราคารวม VAT แล้ว)',
      'doc.payMethod': 'วิธีชำระเงิน', 'doc.pay.cash': 'เงินสด', 'doc.pay.transfer': 'โอนเงิน', 'doc.pay.other': 'อื่น ๆ',
      'doc.make': 'ออกเอกสาร', 'doc.popupBlocked': 'เบราว์เซอร์บล็อกป๊อปอัป กรุณาอนุญาตแล้วลองใหม่', 'doc.print': 'พิมพ์ / บันทึก PDF',
      'doc.yourStore': '(ชื่อร้านของคุณ)', 'doc.no': 'เลขที่', 'doc.date': 'วันที่', 'doc.receivedFrom': 'ได้รับเงินจาก', 'doc.ref': 'อ้างอิงเลขที่',
      'doc.col.no': 'ลำดับ', 'doc.col.item': 'รายการ', 'doc.col.qty': 'จำนวน', 'doc.col.unit': 'ราคา/หน่วย', 'doc.col.amount': 'จำนวนเงิน',
      'doc.subtotal': 'รวมเป็นเงิน', 'doc.discount': 'ส่วนลด', 'doc.beforeVat': 'มูลค่าก่อน VAT', 'doc.vat7': 'ภาษีมูลค่าเพิ่ม 7%', 'doc.grand': 'รวมทั้งสิ้น',
      'doc.amountWords': 'จำนวนเงิน (ตัวอักษร)', 'doc.payer': 'ลงชื่อผู้จ่ายเงิน', 'doc.payee': 'ลงชื่อผู้รับเงิน', 'doc.footNote': 'เอกสารนี้ออกจากระบบ Simple Store',
      'nav.account': 'บัญชี', 'acct.summary': 'สรุป', 'acct.table': 'รายการ (Table)', 'acct.monthlyTitle': 'รายรับรายจ่ายรายเดือน',
      'acct.year': 'ปี', 'acct.month': 'เดือน', 'acct.income': 'รายรับ', 'acct.expense': 'รายจ่าย', 'acct.net': 'คงเหลือสุทธิ', 'acct.yearNet': 'สุทธิทั้งปี',
      'acct.vatMode': 'การคำนวณ VAT', 'acct.vatAll': 'คิด VAT ทั้งหมด', 'acct.vatTicked': 'เฉพาะรายการที่ติ๊ก', 'acct.vatNone': 'ไม่คิด VAT',
      'acct.outVat': 'ภาษีขาย (จากรายรับ)', 'acct.inVat': 'ภาษีซื้อ (จากรายจ่าย)', 'acct.vatNet': 'VAT สุทธิ (ขาย−ซื้อ)', 'acct.byMonth': 'รายเดือน (ทั้งปี)',
      'acct.date': 'วันที่', 'acct.type': 'ประเภท', 'acct.item': 'รายการ', 'acct.amount': 'จำนวนเงิน', 'acct.vatable': 'คิด VAT',
      'acct.tableNote': 'ติ๊กเพื่อเลือกรายการที่จะคิด VAT (ใช้กับโหมด "เฉพาะรายการที่ติ๊ก")', 'acct.noItems': 'ยังไม่มีรายการ'
    },
    en: {
      'title': 'Simple Store Management', 'crumb': 'Store management console',
      'soon': 'This section is coming soon…',
      'delete': 'Delete', 'edit': 'Edit', 'save': 'Save', 'cancel': 'Cancel',
      'exp.from': 'From', 'exp.to': 'To', 'exp.tag': 'Tag', 'exp.all': 'All',
      'exp.clearFilter': 'Clear filter', 'exp.add': '+ Add entry', 'exp.addTitle': 'Add expense', 'exp.editTitle': 'Edit expense',
      'exp.id': 'ID', 'exp.date': 'Date', 'exp.details': 'Item', 'exp.costPerPiece': 'Cost/pc', 'exp.amount': 'Qty',
      'exp.sumItems': 'Items total', 'exp.shipping': 'Shipping', 'exp.discount': 'Discount', 'exp.net': 'Net',
      'exp.purchaseFrom': 'Bought from', 'exp.pickFrom': '— Select source —', 'exp.note': 'Note', 'exp.totalRows': 'Total', 'exp.empty': 'No expenses yet — add your first entry',
      'exp.delConfirm': 'Delete this entry?',
      'sum.period': 'Period', 'sum.allTime': 'All time', 'sum.tag': 'Tag', 'sum.netTotal': 'Net Total', 'sum.percent': '% of total',
      'sum.sum': 'Sum', 'sum.totalNet': 'Total expenses (net)', 'sum.count': 'Entries', 'sum.avg': 'Average per entry', 'sum.noData': 'No data in this period yet',
      'rev.add': '+ Add order', 'rev.addTitle': 'Add order', 'rev.editTitle': 'Edit order',
      'rev.invoiceNo': 'Invoice #', 'rev.customer': 'Recipient', 'rev.customerHint': 'Recipient full name', 'rev.address': 'Recipient address', 'rev.addressHint': 'Shipping address', 'rev.platform': 'Sold via Platform', 'rev.platformHint': 'e.g. TikTok Shop', 'rev.items': 'Items',
      'rev.orderStatus': 'Order Status', 'rev.invoiceStatus': 'Invoice Status', 'rev.totalRows': 'Total',
      'rev.empty': 'No orders yet — add your first order', 'rev.delConfirm': 'Delete this order?',
      'rev.addItem': '+ Add item', 'rev.itemName': 'Product name', 'rev.itemPrice': 'Price', 'rev.itemsTotal': 'Items total',
      'rev.errCustomer': 'Please enter recipient name', 'rev.errAddress': 'Please enter recipient address', 'rev.errItems': 'Please add at least one item', 'rev.errPickProduct': 'Please pick products from the list only', 'rev.pickProduct': '— Select product —', 'rev.noProducts': 'No products yet — please add products first in the Products page',
      'prod.pinTitle': 'This page needs a PIN', 'prod.pinDesc': 'Enter your 6-digit PIN to manage products', 'prod.pinWrong': 'Wrong PIN, please try again', 'prod.pinClear': 'Clear',
      'prod.restock': '+ Restock', 'prod.add': '+ Add product',
      'rst.title': 'Restock product', 'rst.ptype': 'Category', 'rst.allTypes': 'All categories', 'rst.noneInType': 'No products in this category', 'rst.product': 'Product', 'rst.qty': 'Quantity added', 'rst.date': 'Date', 'rst.signature': 'Added by (Signature)', 'rst.signatureHint': 'Type your name', 'rst.confirm': 'Confirm restock',
      'rst.errQty': 'Quantity must be greater than 0', 'rst.errSign': 'Please enter your name',
      'sh.product': 'Product', 'sh.action': 'Action', 'sh.ptype': 'Category', 'sh.type': 'Type', 'sh.typeRestock': 'Restock', 'sh.typeNew': 'New Product', 'sh.qty': 'Qty', 'sh.any': 'Any', 'sh.gt': 'Greater than', 'sh.lt': 'Less than', 'sh.eq': 'Equals', 'sh.qtyVal': 'Qty',
      'sh.signature': 'Added by', 'sh.signHint': 'Search name', 'sh.qtyAdded': 'Qty added', 'sh.totalRows': 'Total', 'sh.empty': 'No restock history yet',
      'io.exportTitle': 'Export Simple Store data', 'io.exportDesc': 'Download everything (expenses/orders/products/settings/stock history) as a JSON file — one file restores it all',
      'io.json': 'Download JSON (full backup)', 'io.importTitle': 'Import Simple Store data', 'io.importDesc': 'Upload a JSON backup — this REPLACES all Simple Store data (not a merge)',
      'io.chooseFile': 'Choose file', 'io.noFile': 'No file chosen', 'io.importBtn': 'Import',
      'io.replaceWarn': 'Import will REPLACE all Simple Store data (currently {n} records) — continue?',
      'io.importDone': 'Import successful', 'io.importFail': 'Import failed — invalid file',
      'io.csvExportLabel': 'Or export a single table as CSV (opens in Excel):', 'io.csvExp': 'Expenses CSV', 'io.csvOrd': 'Orders CSV', 'io.csvProd': 'Products CSV',
      'io.importNote': '⚠️ CSV import works for Expenses and Products only (new id=create · existing id=update · action=delete to remove) — Orders can only be imported via JSON (items bind to product IDs)',
      'io.csvDone': 'Imported {t} — created {c} · updated {u} · deleted {d}', 'io.tbl_expenses': 'Expenses', 'io.tbl_products': 'Products', 'prod.addTitle': 'Add product', 'prod.editTitle': 'Edit product',
      'prod.image': 'Image', 'prod.sku': 'SKU', 'prod.name': 'Product name', 'prod.cost': 'Cost', 'prod.price': 'Price',
      'prod.sale': 'Sale',
      'promo.btn': 'Promotion', 'promo.navLabel': 'Promotion',
      'promo.title': 'Manage Promotions', 'promo.desc': 'Schedule discounts by category/product · items go on sale automatically during the window and stop when it ends (checked on app open)',
      'promo.new': '+ New Promotion', 'promo.empty': 'No promotions yet', 'promo.close': 'Close',
      'promo.untitled': '(untitled)', 'promo.itemsUnit': 'items', 'promo.selected': 'selected',
      'promo.status.active': 'On Sale', 'promo.status.scheduled': 'Scheduled', 'promo.status.ended': 'Ended',
      'promo.addTitle': 'New Promotion', 'promo.editTitle': 'Edit Promotion',
      'promo.name': 'Promotion name', 'promo.namePh': 'e.g. 11.11 Sale, Summer Deal',
      'promo.effDate': 'Effective date', 'promo.endDate': 'End date',
      'promo.pickProducts': 'Pick products to discount', 'promo.category': 'Category', 'promo.noCat': '— No category —',
      'promo.addItem': 'Add this', 'promo.pickProduct': '— Select product —', 'promo.noneLeft': 'No products left in this category', 'promo.emptyPicked': 'No products selected yet',
      'promo.noProdInCat': 'No products in this category', 'promo.delConfirm': 'Delete this promotion?',
      'promo.errDates': 'Please set both start and end dates', 'promo.errRange': 'End date cannot be before start date', 'promo.errItems': 'Please pick at least one product',
      'promo.endedTitle': 'Promotion ended', 'promo.endedOn': 'ended',
      'prod.stock': 'Stock', 'prod.reserved': 'Reserved', 'prod.sold': 'Sold', 'prod.ptype': 'Category', 'prod.pickType': '— Select category —', 'prod.errType': 'Please select a category', 'prod.tag': 'Status', 'prod.empty': 'No products yet — add your first one',
      'prod.delConfirm': 'Delete this product? (past orders keep their name/price)', 'prod.errSku': 'Please enter a SKU', 'prod.errName': 'Please enter a product name', 'exp.errDetails': 'Please enter item details', 'exp.errDate': 'Please pick a date', 'exp.errAmount': 'Quantity must be greater than 0',
      'nav.expense': 'Expenses', 'nav.summary': 'Cost Summary', 'nav.revenue': 'Revenue / Billing',
      'nav.orderStatus': 'Order Status', 'nav.invoiceStatus': 'Invoice Status',
      'nav.products': 'Products', 'nav.stockHistory': 'Stock History', 'nav.setting': 'Settings',
      'set.title': 'Settings', 'set.desc': 'Manage the labels and colours of your tags and statuses — add, rename, recolour or delete.',
      'set.expenseTags': 'Expense Tags', 'set.revenueTags': 'Revenue / Billing Tags',
      'set.orderStatuses': 'Order Statuses', 'set.invoiceStatuses': 'Invoice Statuses',
      'set.add': '+ Add', 'set.none': 'No items yet', 'set.newItem': 'New item',
      'set.delConfirm': 'Delete this item?', 'set.lockedHint': 'This status drives stock — rename/recolour allowed, but cannot be deleted',
      'set.broughtFrom': 'Brought From', 'set.productTypes': 'Categories', 'set.prefixTitle': 'ID Prefixes', 'set.prefixDesc': 'Set the leading code (max 4 chars) for expenses and orders',
      'set.prefixExpense': 'Expense ID prefix', 'set.prefixOrder': 'Order invoice prefix',
      'kb.empty': 'No orders', 'kb.completeHint': 'Drop an order here → moves to Completed page automatically', 'kb.paidHint': 'Drop an order here → mark as paid (counts as Sold)',
      'bp.title': 'Business Profile (for documents)', 'bp.desc': 'Used as the header on every financial document (receipt voucher, etc.)',
      'bp.name': 'Store / business name', 'bp.address': 'Address', 'bp.phone': 'Contact phone', 'bp.taxId': 'Tax ID (if any)',
      'bp.logo': 'Logo', 'bp.signature': 'Signature', 'bp.stamp': 'Stamp', 'bp.vatDefault': 'Default: calculate VAT 7%', 'bp.remove': 'Remove image',
      'doc.rv.title': 'Receipt Voucher', 'doc.optsDesc': 'Pick options, then print / save as PDF.',
      'doc.bn.title': 'Billing Note', 'doc.rc.title': 'Receipt', 'doc.makeTitle': 'Generate document',
      'doc.billTo': 'Bill to', 'doc.biller': 'Biller signature', 'doc.billReceiver': 'Received by signature',
      'doc.st.received': 'Received in full and in order.', 'doc.st.pleasePay': 'Please pay the grand total above.',
      'doc.noProfile': '⚠ No business profile set in Settings — the document will have no header.', 'doc.vat': 'Calculate VAT 7% (VAT-inclusive)',
      'doc.payMethod': 'Payment method', 'doc.pay.cash': 'Cash', 'doc.pay.transfer': 'Bank transfer', 'doc.pay.other': 'Other',
      'doc.make': 'Generate', 'doc.popupBlocked': 'Popup blocked — please allow popups and try again.', 'doc.print': 'Print / Save PDF',
      'doc.yourStore': '(Your store name)', 'doc.no': 'No.', 'doc.date': 'Date', 'doc.receivedFrom': 'Received from', 'doc.ref': 'Ref.',
      'doc.col.no': 'No.', 'doc.col.item': 'Description', 'doc.col.qty': 'Qty', 'doc.col.unit': 'Unit price', 'doc.col.amount': 'Amount',
      'doc.subtotal': 'Subtotal', 'doc.discount': 'Discount', 'doc.beforeVat': 'Before VAT', 'doc.vat7': 'VAT 7%', 'doc.grand': 'Grand total',
      'doc.amountWords': 'Amount in words', 'doc.payer': 'Payer signature', 'doc.payee': 'Payee signature', 'doc.footNote': 'Issued from Simple Store',
      'nav.account': 'Account', 'acct.summary': 'Summary', 'acct.table': 'Table', 'acct.monthlyTitle': 'Monthly income & expense',
      'acct.year': 'Year', 'acct.month': 'Month', 'acct.income': 'Income', 'acct.expense': 'Expense', 'acct.net': 'Net', 'acct.yearNet': 'Year net',
      'acct.vatMode': 'VAT calculation', 'acct.vatAll': 'VAT on all', 'acct.vatTicked': 'Only ticked items', 'acct.vatNone': 'No VAT',
      'acct.outVat': 'Output VAT (income)', 'acct.inVat': 'Input VAT (expense)', 'acct.vatNet': 'Net VAT (out−in)', 'acct.byMonth': 'By month (full year)',
      'acct.date': 'Date', 'acct.type': 'Type', 'acct.item': 'Item', 'acct.amount': 'Amount', 'acct.vatable': 'VAT',
      'acct.tableNote': 'Tick items to include in VAT (used by the "Only ticked items" mode)', 'acct.noItems': 'No items yet'
    }
  });
})();
