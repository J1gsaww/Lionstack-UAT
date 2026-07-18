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
  // Bilingual display: show item.nameEn when app lang = en (falls back to the canonical item.name, which stays the stored/matched value).
  const itemLabel = (it)=> { if(!it) return ''; const en=(window.appLang&&window.appLang())==='en'; return en ? (it.nameEn||it.name||'') : (it.nameTh||it.name||''); };
  const dispName = (groupKey, storedName)=>{ const it=(config[groupKey]||[]).find(x=> x.name===storedName); return it ? itemLabel(it) : storedName; };
  const _fmtEditedAt = (iso)=> iso ? (String(iso).slice(0,10)+' '+String(iso).slice(11,16)) : '';
  const editedLabel = (rec)=>{ const by=rec.editedBy||rec.createdBy||''; const at=rec.editedAt||rec.createdAt||''; if(!by && !at) return '-'; return (by||'-') + (at ? ' \u00B7 '+_fmtEditedAt(at) : ''); };
  // Colour of a sold line: stored on the item, with a lookup fallback for older orders.
  function itemColorLabel(it){
    if(!it) return '';
    if(it.colorName) return it.colorName;
    if(!it.colorId) return '';
    const p = products.find(x=> x.id === it.productId);
    const c = (p && Array.isArray(p.colors)) ? p.colors.find(x=> x.id === it.colorId) : null;
    return c ? (c.name || '') : '';
  }
  async function saveDeletedOrders(){ await window.Store.set(K_DELORDERS, deletedOrders); }
  async function saveDeletedProducts(){ await window.Store.set(K_DELPRODUCTS, deletedProducts); }
  // Deleting never destroys a record: it moves to the Deleted List, out of every
  // total, until someone with the right permission restores it.
  function toBin(rec){ return Object.assign(JSON.parse(JSON.stringify(rec)), { deletedAt: new Date().toISOString(), deletedBy: currentActorName() }); }
  async function saveOrderLog(){ await window.Store.set(K_ORDERLOG, orderLog); }
  async function saveProductLog(){ await window.Store.set(K_PRODUCTLOG, productLog); }
  function logRec(arr, saveFn, entityId, label, action, snapshot, extra){ arr.push(Object.assign({ id: rid(), entityId, label: label||entityId, action, at: new Date().toISOString(), by: currentActorName(), snapshot: snapshot ? JSON.parse(JSON.stringify(snapshot)) : null }, extra || {})); saveFn(); }
  // Which image files came and went between two product versions. Only the FILE
  // NAME (and the colour it belongs to) is kept — never the deleted image data.
  function imageChangeList(oldP, newP){
    const out = [];
    const cmp = (oldArr, oldNames, newArr, newNames, colorLabel)=>{
      const oa = oldArr || [], na = newArr || [];
      oa.forEach((src, i)=>{ if(na.indexOf(src) < 0) out.push({ act:'remove', name: (oldNames && oldNames[i]) || '', color: colorLabel || '' }); });
      na.forEach((src, i)=>{ if(oa.indexOf(src) < 0) out.push({ act:'add', name: (newNames && newNames[i]) || '', color: colorLabel || '' }); });
    };
    cmp(oldP && oldP.images, oldP && oldP.imageNames, newP && newP.images, newP && newP.imageNames, '');
    const oldCols = (oldP && Array.isArray(oldP.colors)) ? oldP.colors : [];
    const newCols = (newP && Array.isArray(newP.colors)) ? newP.colors : [];
    newCols.forEach(nc=>{ const oc = oldCols.find(c=> c.id === nc.id); cmp(oc && oc.images, oc && oc.imageNames, nc.images, nc.imageNames, nc.name || ''); });
    oldCols.forEach(oc=>{ if(!newCols.some(c=> c.id === oc.id)) cmp(oc.images, oc.imageNames, [], [], oc.name || ''); });
    return out;
  }

  /* ---- Store keys ---- */
  const K_EXPENSES = 'mod_store_expenses';
  const K_ORDERS   = 'mod_store_orders';
  const K_PRODUCTS = 'mod_store_products';
  const K_STOCKLOG = 'mod_store_stocklog';
  const K_LOTS     = 'mod_store_lots';
  const K_DELORDERS   = 'mod_store_deleted_orders';
  const K_DELPRODUCTS = 'mod_store_deleted_products';
  const K_STOCKPUB = 'mod_store_stockpublic'; // quantities only — safe for the public shop (no costs, no orders)
  const K_CONFIG   = 'mod_store_config';   // { expenseTags, revenueTags, orderStatuses, invoiceStatuses }
  const K_PROMOS   = 'mod_store_promotions'; // [{ id, name, effectiveDate, endDate, items:[{productId,percent}], closed, endedAck }]
  const K_ORDERLOG   = 'mod_store_orderlog';
  const K_PRODUCTLOG = 'mod_store_productlog';
  const K_DELIVERIES = 'mod_store_deliveries'; // [{ id, orderId, status, createdAt }]

  /* ---- Default tags / statuses (seed config on first run) ---- */
  const DEFAULT_EXPENSE_TAGS = [
    { name:'Product',         color:'#5B8FB0', role:'product', locked:true },
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
    { name:'Shipped',          color:'#7C6A55', role:'shipped', locked:true },
    { name:'Completed',        color:'#6B8F71', role:'complete', locked:true }
  ];
  const DEFAULT_INVOICE_STATUSES = [
    { name:'Draft',          color:'#9B8B78' },
    { name:'Sent',           color:'#FDBD31' },
    { name:'Partially paid', color:'#FB7562' },
    { name:'Paid',           color:'#6B8F71', role:'paid', locked:true }
  ];
  const DEFAULT_DELIVERY_STATUSES = [
    { name:'Wait for Delivery',  color:'#9B8B78', role:'waiting',    locked:true },
    { name:'Delivering',         color:'#FDBD31', role:'delivering', locked:true },
    { name:'Success',            color:'#6B8F71', role:'success' },
    { name:'A Problem Occurred', color:'#C6432E', role:'problem' },
    { name:'Returned',           color:'#7C6A55', role:'returned' }
  ];
  // Shipping types: 'Our Driver' + 'Outsource Driver' are locked (rename-only, can't delete); more can be added.
  const DEFAULT_SHIPPING_TYPES = [
    { name:'Our Driver',       color:'#5B8FB0', role:'our',       locked:true },
    { name:'Outsource Driver', color:'#C99A4E', role:'outsource', locked:true },
  ];
  const DEFAULT_OUTSOURCES = [{name:'Shopee'},{name:'Flash'},{name:'Thai Delivery'},{name:'Delivery A'},{name:'Delivery B'}];
  const DEFAULT_BROUGHT_FROM = [{name:'Local Shop'},{name:'Shopee'},{name:'Lazada'}];
  const DEFAULT_PRODUCT_TYPES = [
    { name:'Type A', color:'#6B8F71' },
    { name:'Type B', color:'#FDBD31' },
    { name:'Type C', color:'#FB7562' }
  ];
  const DEFAULT_COST_ORIGINS = [
    { name:'Shop A', color:'#6B8F71' },
    { name:'Shop B', color:'#FDBD31' },
    { name:'Shop C', color:'#FB7562' }
  ];

  /* ---- State ---- */
  let subPage = 'expense';
  let config = null;   // { expenseTags:[], revenueTags:[], orderStatuses:[], invoiceStatuses:[] }
  let expenses = [];
  let expFilter = { from:'', to:'', tag:'all' };
  let expEditingId = null;
  let expEditingOrigDate = null;
  let orders = [];
  let deliveries = [];
  let delFilter = { from:'', to:'', province:'all', region:'all', status:'all' };
  let delCalDate = null;
  let delCalFilter = { type:'all', driver:'all' };
  let delCalColorBy = 'status';
  let shipRegion = null;
  let shipCat = null;
  let ordFilter = { from:'', to:'', orderStatus:'all', invoiceStatus:'all', tag:'all' };
  let ordEditingId = null;
  let products = [];
  let stockLog = [];
  let lots = [];
  let promotions = [];
  let orderLog = [];
  let deletedOrders = [];
  let deletedProducts = [];
  let productLog = [];
  let _ehDetail = null;
  let _ledgerMode = false;
  let prodEditingId = null;
  let prodImageData = null;
  let prodBillData = null;
  const PRODUCT_TAGS = [
    { name:'In Stock',     color:'#6B8F71' },
    { name:'Pre-Order',    color:'#FDBD31' },
    { name:'Out of Stock', color:'#C6432E' }
  ];
  // Thai display names for the built-in defaults (canonical English `name` stays the stored/matched key).
  const _NAME_TH = {
    'Instrument':'เครื่องมือ/อุปกรณ์','Fix Cost':'ต้นทุนคงที่','Production Cost':'ต้นทุนการผลิต','Convenience':'ค่าอำนวยความสะดวก','Future usage':'สำรองไว้ใช้อนาคต','Waste':'ของเสีย',
    'From Stock':'จากสต็อก','Pre-Order':'พรีออเดอร์',
    'Quotation':'ใบเสนอราคา','Confirmed':'ยืนยันแล้ว','Deposit Received':'รับมัดจำแล้ว','In Production':'กำลังผลิต','Ready to Ship':'พร้อมส่ง','Shipped':'จัดส่งแล้ว','Completed':'เสร็จสมบูรณ์',
    'Draft':'ฉบับร่าง','Sent':'ส่งแล้ว','Partially paid':'ชำระบางส่วน','Paid':'ชำระแล้ว',
    'Wait for Delivery':'รอจัดส่ง','Delivering':'กำลังจัดส่ง','Success':'สำเร็จ','A Problem Occurred':'เกิดปัญหา','Returned':'ตีกลับ',
    'Our Driver':'คนขับของร้าน','Outsource Driver':'คนขับภายนอก',
    'Thai Delivery':'ไทยเดลิเวอรี่','Delivery A':'ขนส่ง A','Delivery B':'ขนส่ง B',
    'Local Shop':'ร้านค้าท้องถิ่น',
    'Type A':'ประเภท A','Type B':'ประเภท B','Type C':'ประเภท C',
    'Shop A':'ร้าน A','Shop B':'ร้าน B','Shop C':'ร้าน C',
    'In Stock':'มีสินค้า','Out of Stock':'สินค้าหมด'
  };
  [DEFAULT_EXPENSE_TAGS, DEFAULT_REVENUE_TAGS, DEFAULT_ORDER_STATUSES, DEFAULT_INVOICE_STATUSES, DEFAULT_DELIVERY_STATUSES, DEFAULT_SHIPPING_TYPES, DEFAULT_OUTSOURCES, DEFAULT_BROUGHT_FROM, DEFAULT_PRODUCT_TYPES, DEFAULT_COST_ORIGINS, PRODUCT_TAGS].forEach(list=> list.forEach(it=>{ if(_NAME_TH[it.name] && !it.nameTh) it.nameTh = _NAME_TH[it.name]; }));

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
      deliveryStatuses: DEFAULT_DELIVERY_STATUSES.map(x=> ({ id: rid(), ...x })),
      shippingTypes: DEFAULT_SHIPPING_TYPES.map(x=> ({ id: rid(), ...x })),
      outsources: DEFAULT_OUTSOURCES.map(o=> ({ id: rid(), color: '#8A8F80', ...o })),
      broughtFrom: DEFAULT_BROUGHT_FROM.map(o=> ({ id: rid(), ...o })),
      productTypes: DEFAULT_PRODUCT_TYPES.map(x=> ({ id: rid(), ...x })),
      costOrigins: DEFAULT_COST_ORIGINS.map(x=> ({ id: rid(), ...x })),
      prefixes: { expense: 'CSA', order: 'ATSC' },
      business: { name:'', nameEn:'', address:'', addressEn:'', phone:'', taxId:'', logo:'', signature:'', stamp:'', vatDefault:false }
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
    if(!os.some(s=> s.role === 'shipped')){ const sh = os.find(s=> s.name === 'Shipped'); if(sh){ sh.role = 'shipped'; sh.locked = true; changed = true; } }
    const et = config.expenseTags || [];
    if(!et.some(t=> t.role === 'product')){
      const exist = et.find(t=> t.name === 'Product');
      if(exist){ exist.role = 'product'; exist.locked = true; }
      else et.unshift({ id: rid(), name:'Product', nameTh:'\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', color:'#5B8FB0', role:'product', locked:true });
      changed = true;
    }
    if(!config.deliveryStatuses){ config.deliveryStatuses = DEFAULT_DELIVERY_STATUSES.map(x=> ({ id: rid(), ...x })); changed = true; }
    if(!config.shippingTypes){ config.shippingTypes = DEFAULT_SHIPPING_TYPES.map(x=> ({ id: rid(), ...x })); changed = true; }
    if(!config.outsources){ config.outsources = DEFAULT_OUTSOURCES.map(o=> ({ id: rid(), color: '#8A8F80', ...o })); changed = true; }
    ['our','outsource'].forEach(rl=>{ if(config.shippingTypes && !config.shippingTypes.some(s=> s.role===rl)){ config.shippingTypes.push({ id: rid(), ...DEFAULT_SHIPPING_TYPES.find(x=> x.role===rl) }); changed = true; } });
    if(!config.broughtFrom){ config.broughtFrom = DEFAULT_BROUGHT_FROM.map(o=> ({ id: rid(), ...o })); changed = true; }
    if(!config.productTypes){ config.productTypes = DEFAULT_PRODUCT_TYPES.map(x=> ({ id: rid(), ...x })); changed = true; }
    if(!config.costOrigins){ config.costOrigins = DEFAULT_COST_ORIGINS.map(x=> ({ id: rid(), ...x })); changed = true; }
    if(!config.prefixes){ config.prefixes = { expense: 'CSA', order: 'ATSC' }; changed = true; }
    if(!config.business){ config.business = { name:'', nameEn:'', address:'', addressEn:'', phone:'', taxId:'', logo:'', signature:'', stamp:'', vatDefault:false }; changed = true; }
    ['expenseTags','revenueTags','orderStatuses','invoiceStatuses','deliveryStatuses','shippingTypes','outsources','broughtFrom','productTypes','costOrigins'].forEach(gk=>{ (config[gk]||[]).forEach(it=>{ if(!it.nameTh && _NAME_TH[it.name]){ it.nameTh = _NAME_TH[it.name]; changed = true; } }); });
    if(changed) saveConfig();
  }
  function statusByRole(group, role){ return (config[group] || []).find(s=> s.role === role) || null; }
  // Accounting (Ledger / VAT / Monthly Report) only counts orders whose invoice
  // status is the LOCKED "paid" one — nothing enters the books before payment.
  function paidStatusName(){ const st = statusByRole('invoiceStatuses','paid'); return st ? st.name : null; }
  function isPaidOrder(o){ const pn = paidStatusName(); return !!pn && o.invoiceStatus === pn; }
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
  /* ============================================================
     MODULE SPLIT — the one "Simple Store" module became FOUR sidebar
     modules over a shared core (same data keys / helpers / renderers):
       Stock Management  : products, stockHistory
       Sell Management   : revenue, orderStatus, invoiceStatus
       Accounting        : expense, summary, account  (+ Import/Export box)
       Business Profile  : setting  (the old in-store Setting subpage)
     Each is a thin registration; the render functions below are untouched.
     ============================================================ */

  let _storeLoaded = false;
  async function ensureLoaded(){
    if(_storeLoaded) return;
    _storeLoaded = true;
    await loadConfig();
    expenses   = await window.Store.list(K_EXPENSES);
    orders     = await window.Store.list(K_ORDERS);
    products   = await window.Store.list(K_PRODUCTS);
    stockLog   = await window.Store.list(K_STOCKLOG);
    lots       = await window.Store.list(K_LOTS);
    deliveries = await window.Store.list(K_DELIVERIES);
    promotions = await window.Store.list(K_PROMOS);
    orderLog   = await window.Store.list(K_ORDERLOG);
    deletedOrders   = await window.Store.list(K_DELORDERS);
    deletedProducts = await window.Store.list(K_DELPRODUCTS);
    productLog = await window.Store.list(K_PRODUCTLOG);
    await migrateStockLots();
    seedShippingCost();
    syncDeliveries();
    await runPromoConditionCheck();
    if(window.registerNotifyProvider){
      window.registerNotifyProvider(()=> promotions
        .filter(p=> p.closed && !p.endedAck)
        .map(p=>{
          const end = p.endDate ? new Date(p.endDate + 'T23:59:59') : new Date();
          return {
            id: 'promo:' + p.id, kind: 'promo', title: T('promo.endedTitle'),
            subtitle: (p.name || T('promo.untitled')) + ' \u00B7 ' + T('promo.endedOn') + ' ' + (p.endDate || '-'),
            tag: T('promo.navLabel'), msLeft: end.getTime() - Date.now(),
            color: '#C6432E', ink: '#FFFFFF',
            onClick: async ()=>{ p.endedAck = true; await savePromotions(); if(window.renderSidebar) window.renderSidebar(); }
          };
        })
      );
    }
  }

  function renderSubpage(id, body){
    _ledgerMode = (id === 'ledger');   // Accounting's read-only copy of the billing table
    if(id === 'profile') renderBusinessProfilePage(body);
    else if(id === 'stockConfig') renderStockConfig(body);
    else if(id === 'sellConfig') renderSellConfig(body);
    else if(id === 'acctConfig') renderAcctConfig(body);
    else if(id === 'expense') renderExpensePage(body);
    else if(id === 'summary') renderSummaryPage(body);
    else if(id === 'account') renderAccountPage(body);
    else if(id === 'ledger') renderRevenuePage(body);
    else if(id === 'vat') renderVatPage(body);
    else if(id === 'deleted') renderDeletedPage(body);
    else if(id === 'revenue') renderRevenuePage(body);
    else if(id === 'products') renderProductsPage(body);
    else if(id === 'orderStatus') renderOrderKanban(body);
    else if(id === 'invoiceStatus') renderInvoiceKanban(body);
    else if(id === 'stockHistory') renderStockHistory(body);
    else if(id === 'deliveryList') renderDeliveryPage(body);
    else if(id === 'deliveryBoard') renderDeliveryKanban(body);
    else if(id === 'deliveryCalendar') renderDeliveryCalendar(body);
    else if(id === 'deliveryDrivers') renderDriverColors(body);
    else if(id === 'grouping') renderDeliveryConfig(body);
    else if(id === 'shippingCost') renderShippingCost(body);
    else if(id === 'productHistory') renderEditHistory('product', body);
    else if(id === 'orderHistory') renderEditHistory('order', body);
    else body.innerHTML = `<div class="panel"><p class="setting-desc">${esc(T('soon'))}</p></div>`;
  }
  function ehActionText(a){ return T('eh.'+a); }
  function ehActionBadge(a){ const c = a==='create'?'#6B8F71':(a==='delete'?'#C6432E':'#E0A100'); return `<span class="art-pill" style="background:${c}">${esc(ehActionText(a))}</span>`; }
  function showRawSnapshot(ev){
    const ov = document.createElement('div'); ov.className='art-modal-overlay show';
    ov.innerHTML = `<div class="art-modal" style="max-width:680px;"><h3 class="art-modal-title">${esc(T('eh.rawTitle'))}</h3><p class="setting-desc" style="margin:-4px 0 10px;">${esc(ev.label||'')} \u00B7 ${esc(ehActionText(ev.action))} \u00B7 ${esc(_fmtEditedAt(ev.at))} \u00B7 ${esc(ev.by||'-')}</p><pre class="eh-raw-pre">${esc(ev.snapshot ? JSON.stringify(ev.snapshot, null, 2) : '-')}</pre><div class="art-modal-actions"><button class="btn btn-primary" id="ehClose">${esc(T('close'))}</button></div></div>`;
    document.body.appendChild(ov);
    const close=()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#ehClose').addEventListener('click', close);
  }
  function renderEditHistory(kind, body){
    if(_ehDetail && _ehDetail.kind===kind){ renderEditHistoryDetail(kind, body); return; }
    const log = kind==='order' ? orderLog : productLog;
    const byId = {};
    log.forEach(e=>{ (byId[e.entityId] = byId[e.entityId] || []).push(e); });
    const records = Object.keys(byId).map(eid=>{
      const evs = byId[eid].slice().sort((a,b)=> String(b.at||'').localeCompare(String(a.at||'')));
      return { eid, label: evs[0].label, events: evs, last: evs[0] };
    }).sort((a,b)=> String(b.last.at||'').localeCompare(String(a.last.at||'')));
    body.innerHTML = `<div class="art-table-wrap"><table class="art-table"><thead><tr><th>${esc(T('eh.record'))}</th><th class="num">${esc(T('eh.changes'))}</th><th>${esc(T('eh.lastAction'))}</th><th>${esc(T('eh.lastEdited'))}</th></tr></thead><tbody>${records.length ? records.map(r=> `<tr class="eh-rec" data-eid="${esc(r.eid)}"><td>${esc(r.label||r.eid)}</td><td class="num">${r.events.length}</td><td>${ehActionBadge(r.last.action)}</td><td class="art-edited">${esc((r.last.by||'-')+' \u00B7 '+_fmtEditedAt(r.last.at))}</td></tr>`).join('') : `<tr><td colspan="4" class="art-empty">${esc(T('eh.empty'))}</td></tr>`}</tbody></table></div>`;
    body.querySelectorAll('.eh-rec').forEach(tr=> tr.addEventListener('click', ()=>{ const lg = kind==='order' ? orderLog : productLog; const es = lg.filter(e=> e.entityId === tr.dataset.eid).slice().sort((a,b)=> String(b.at||'').localeCompare(String(a.at||''))); _ehDetail = { kind, eid: tr.dataset.eid, evId: es.length ? es[0].id : null }; renderEditHistory(kind, body); }));
  }
  function renderEditHistoryDetail(kind, body){
    const log = kind==='order' ? orderLog : productLog;
    const evsDesc = log.filter(e=> e.entityId === _ehDetail.eid).slice().sort((a,b)=> String(b.at||'').localeCompare(String(a.at||'')));
    if(!evsDesc.length){ _ehDetail = null; renderEditHistory(kind, body); return; }
    if(!_ehDetail.evId || !evsDesc.some(e=> e.id===_ehDetail.evId)) _ehDetail.evId = evsDesc[0].id;
    const label = evsDesc[0].label;
    const asc = evsDesc.slice().reverse();
    const idx = asc.findIndex(x=> x.id===_ehDetail.evId);
    const ev = asc[idx];
    const prev = idx>0 ? asc[idx-1] : null;
    const oldObj = (ev.action==='create') ? null : (prev ? prev.snapshot : null);
    const newObj = (ev.action==='delete') ? null : ev.snapshot;
    const pills = evsDesc.map(e=> `<button type="button" class="eh-evpill ${e.id===_ehDetail.evId?'active':''}" data-id="${esc(e.id)}">${ehActionBadge(e.action)}<span class="eh-evpill-at">${esc(_fmtEditedAt(e.at))} \u00B7 ${esc(e.by||'-')}</span></button>`).join('');
    body.innerHTML = `<button type="button" class="btn btn-ghost" id="ehBack">\u2190 ${esc(T('eh.back'))}</button><div class="eh-diff-head-bar"><h3 class="art-form-section" style="margin:12px 0 2px;">${esc(label)}</h3><button type="button" class="btn btn-ghost" id="ehRawBtn">${esc(T('eh.viewRaw'))}</button></div>${evsDesc.length>1 ? `<div class="eh-evsel">${pills}</div>` : ''}${renderDiffView(kind, oldObj, newObj)}${imageChangesHtml(ev)}`;
    body.querySelector('#ehBack').addEventListener('click', ()=>{ _ehDetail = null; renderEditHistory(kind, body); });
    body.querySelector('#ehRawBtn').addEventListener('click', ()=> showRawSnapshot(ev));
    body.querySelectorAll('.eh-evpill').forEach(b=> b.addEventListener('click', ()=>{ _ehDetail.evId = b.dataset.id; renderEditHistoryDetail(kind, body); }));
  }
  function orderDiffFields(){ return [
    {key:'date', label:T('exp.date')},
    {key:'orderStatus', label:T('rev.orderStatus'), fmt:(v)=> dispName('orderStatuses', v)},
    {key:'invoiceStatus', label:T('rev.invoiceStatus'), fmt:(v)=> dispName('invoiceStatuses', v)},
    {key:'tag', label:T('exp.tag'), fmt:(v)=> dispName('revenueTags', v)},
    {key:'platform', label:T('rev.platform')},
    {key:'customerName', label:T('rev.customer')},
    {key:'phone', label:T('rev.phone')},
    {key:'deliveryMethod', label:T('rev.deliveryMethod'), fmt:(v)=> dispName('shippingTypes', v)},
    {key:'deliveryResponsible', label:T('rev.responsible')},
    {key:'address', label:T('rev.address')},
    {key:'shippingCost', label:T('rev.shippingCost'), fmt:(v)=> fmt(v||0)},
    {key:'overallDiscount', label:T('rev.overallDiscount'), fmt:(v)=> fmt(v||0)},
    {key:'note', label:T('eh.note')}
  ]; }
  function productDiffFields(){ return [
    {key:'sku', label:T('prod.sku')},
    {key:'name', label:T('prod.name')},
    {key:'productType', label:T('prod.ptype'), fmt:(v)=> dispName('productTypes', v)},
    {key:'description', label:T('prod.desc')},
    {key:'cost', label:T('prod.cost'), fmt:(v)=> fmt(v||0)},
    {key:'price', label:T('prod.price'), fmt:(v)=> fmt(v||0)},
    {key:'stock', label:T('prod.stock')},
    {key:'tag', label:T('prod.tag')}
  ]; }
  function _diffRow(label, ov, nv, changed){
    const o = (ov==null||ov==='') ? '\u2014' : esc(String(ov));
    const n = (nv==null||nv==='') ? '\u2014' : esc(String(nv));
    return `<div class="eh-diff-row ${changed?'eh-changed':''}"><div class="eh-diff-label">${esc(label)}</div><div class="eh-diff-old">${o}</div><div class="eh-diff-arrow">\u2192</div><div class="eh-diff-new">${n}</div></div>`;
  }
  function _itemsDiff(oldObj, newObj){
    const f = (obj)=> (obj && obj.items ? obj.items : []).map(it=>{ const c = itemColorLabel(it); return esc((it.productName||'-')+(c?' ('+c+')':'')+' \u00B7 '+(it.qty||0)+'\u00D7'+fmt(it.price||0)+(it.discount?' -'+fmt(it.discount)+(it.discountType==='percent'?'%':''):'')); }).join('<br>') || '\u2014';
    const ov = oldObj ? f(oldObj) : null, nv = newObj ? f(newObj) : null;
    const changed = String(ov==null?'\u0000':ov) !== String(nv==null?'\u0000':nv);
    return `<div class="eh-diff-row ${changed?'eh-changed':''}"><div class="eh-diff-label">${esc(T('eh.items'))}</div><div class="eh-diff-old">${ov==null?'\u2014':ov}</div><div class="eh-diff-arrow">\u2192</div><div class="eh-diff-new">${nv==null?'\u2014':nv}</div></div>`;
  }
  function imageChangesHtml(ev){
    const ch = (ev && Array.isArray(ev.imageChanges)) ? ev.imageChanges : [];
    if(!ch.length) return '';
    return `<div class="eh-imgch"><div class="eh-imgch-title">${esc(T('eh.imgChanges'))}</div>` + ch.map(c=>
      `<div class="eh-imgch-row"><span class="eh-imgch-act ${c.act==='add'?'add':'rm'}">${esc(c.act==='add'?T('eh.imgAdded'):T('eh.imgRemoved'))}</span><span class="eh-imgch-name">${esc(c.name || T('eh.imgNoName'))}</span>${c.color ? `<span class="eh-imgch-color"><span class="pc-dot" style="background:transparent"></span>${esc(T('pc.colorLabel'))}: ${esc(c.color)}</span>` : ''}</div>`
    ).join('') + `</div>`;
  }
  function renderDiffView(kind, oldObj, newObj){
    const fields = kind==='order' ? orderDiffFields() : productDiffFields();
    const rows = fields.map(f=>{
      const ov = oldObj ? (f.fmt ? f.fmt(oldObj[f.key], oldObj) : (oldObj[f.key]==null?'':oldObj[f.key])) : null;
      const nv = newObj ? (f.fmt ? f.fmt(newObj[f.key], newObj) : (newObj[f.key]==null?'':newObj[f.key])) : null;
      const changed = String(ov==null?'\u0000':ov) !== String(nv==null?'\u0000':nv);
      return _diffRow(f.label, ov, nv, changed);
    }).join('');
    const items = kind==='order' ? _itemsDiff(oldObj, newObj) : '';
    const head = `<div class="eh-diff-row eh-diff-head"><div class="eh-diff-label"></div><div class="eh-diff-old">${esc(T('eh.old'))}</div><div class="eh-diff-arrow"></div><div class="eh-diff-new">${esc(T('eh.new'))}</div></div>`;
    return `<div class="eh-diff">${head}${rows}${items}</div>`;
  }

    const _dataTools = {
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
    };

  const REGION_KEYS_4 = ['north','northeast','central','south'];
  const REGION_KEYS_6 = ['north','northeast','central','east','west','south'];
  function regionMode(){ return (config && config.regionMode === '4') ? '4' : '6'; }   // default 6 (official)
  function regionKeys(){ return regionMode()==='4' ? REGION_KEYS_4 : REGION_KEYS_6; }
  function regionOfProvince(c){
    c = +c;
    if(c>=30 && c<=49) return 'northeast';
    if(c>=80 && c<=96) return 'south';
    if(regionMode()==='4'){ return (c>=50 && c<=67) ? 'north' : 'central'; }
    if(c>=50 && c<=58) return 'north';
    if([20,21,22,23,24,25,27].includes(c)) return 'east';
    if([63,70,71,76,77].includes(c)) return 'west';
    return 'central';
  }
  function regionOfProvinceMode(c, m){
    c=+c;
    if(c>=30&&c<=49) return 'northeast';
    if(c>=80&&c<=96) return 'south';
    if(m==='4') return (c>=50&&c<=67)?'north':'central';
    if(c>=50&&c<=58) return 'north';
    if([20,21,22,23,24,25,27].includes(c)) return 'east';
    if([63,70,71,76,77].includes(c)) return 'west';
    return 'central';
  }
  // Auto shipping cost for a product category → delivery province, from config.shippingCost.byCat.
  function shipCostFor(catName, provinceCode){
    const sc=config.shippingCost; if(!sc||!sc.byCat||!provinceCode) return 0;
    const cs=sc.byCat[catName]; if(!cs) return 0;
    if(sc.mode==='province'){
      if(cs.prov && cs.prov[provinceCode]!=null) return +cs.prov[provinceCode]||0;
      if((sc.provMode||'exception')==='exception'){ const reg=regionOfProvinceMode(provinceCode, regionMode()); return +((regionMode()==='4'?cs.r4:cs.r6)[reg])||0; }
      return 0;
    }
    const reg=regionOfProvinceMode(provinceCode, sc.mode);
    return +((sc.mode==='4'?cs.r4:cs.r6)[reg])||0;
  }
  function syncDeliveries(){
    if(!config) return;
    const waitName  = (statusByRole('deliveryStatuses','waiting')    || {}).name;
    const delivName = (statusByRole('deliveryStatuses','delivering') || {}).name;
    const shipName  = (statusByRole('orderStatuses','shipped')       || {}).name;
    let changed = false;
    const before = deliveries.length;
    deliveries = deliveries.filter(d=> orders.some(o=> o.id === d.orderId));
    if(deliveries.length !== before) changed = true;
    orders.forEach(o=>{
      let d = deliveries.find(x=> x.orderId === o.id);
      if(!d){ d = { id: rid(), orderId: o.id, status: waitName || '', createdAt: new Date().toISOString() }; deliveries.push(d); changed = true; }
      if(shipName && o.orderStatus === shipName && waitName && d.status === waitName){ d.status = delivName || d.status; changed = true; }
    });
    if(changed) saveDeliveries();
  }
  function deliveryRow(r, dStatuses){
    const o = r.o, d = r.d; const ap = o.addressParts || {};
    const reg = ap.provinceCode ? T('region.' + regionOfProvince(ap.provinceCode)) : '-';
    const col = (dStatuses.find(s=> s.name === d.status) || {}).color || '#888';
    const von = !!d.verified;
    const canV = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'verifyDelivery');
    const vpill = `<span class="art-pill del-verify ${canV?'del-verify-btn':''}" data-vid="${d.id}" style="background:${von?'#6B8F71':'#C6432E'};">${esc(von?T('sh.verYes'):T('sh.verNo'))}</span>${(von && d.verifiedBy) ? ` <span class="sh-verify-by">${esc(d.verifiedBy)}</span>` : ''}`;
    const canDate = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'setDeliveryDate');
    const ddCell = canDate ? `<input type="date" class="del-date art-inline-date" data-vid="${d.id}" value="${esc(d.deliveryDate||'')}">` : `<span>${esc(d.deliveryDate||'-')}</span>`;
    return `<tr>
      <td>${esc(o.date || '-')}</td>
      <td>${esc(o.invoiceNumber || '-')}</td>
      <td>${esc(o.customerName || '-')}</td>
      <td>${esc(ap.provinceName || '-')}</td>
      <td>${esc(reg)}</td>
      <td class="del-addr" title="${esc(o.address || '')}">${esc(o.address || '-')}</td>
      <td>${esc(o.deliveryMethod || '-')}</td>
      <td>${esc(o.deliveryResponsible || '-')}</td>
      <td>${o.deliveryProof ? `<button type="button" class="acc-icon del-proof-btn" data-oid="${o.id}" title="${esc(T('del.proof'))}">\uD83D\uDCCE</button>` : '-'}</td>
      <td><select class="del-status art-inline-sel" data-id="${d.id}" style="background:${col};">${dStatuses.map(st=> `<option value="${esc(st.name)}" ${d.status===st.name?'selected':''}>${esc(itemLabel(st))}</option>`).join('')}</select></td>
      <td class="del-sticky-date">${ddCell}</td>
      <td class="del-sticky-ver">${vpill}</td>
    </tr>`;
  }
  function renderDeliveryPage(body){
    syncDeliveries();
    const dStatuses = config.deliveryStatuses || [];
    const all = deliveries.map(d=> ({ d, o: orders.find(x=> x.id === d.orderId) })).filter(r=> r.o);
    const provinces = [...new Set(all.map(r=> (r.o.addressParts||{}).provinceName).filter(Boolean))].sort();
    const filtered = all.filter(r=>{
      const ap = r.o.addressParts || {};
      if(delFilter.from && (r.o.date||'') < delFilter.from) return false;
      if(delFilter.to   && (r.o.date||'') > delFilter.to) return false;
      if(delFilter.province !== 'all' && ap.provinceName !== delFilter.province) return false;
      if(delFilter.region   !== 'all' && regionOfProvince(ap.provinceCode) !== delFilter.region) return false;
      if(delFilter.status   !== 'all' && r.d.status !== delFilter.status) return false;
      return true;
    });
    body.innerHTML = `
      <div class="panel">
        <div class="art-toolbar">
          <div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="delFrom" value="${esc(delFilter.from)}"></div>
          <div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="delTo" value="${esc(delFilter.to)}"></div>
          <div class="art-field"><label>${esc(T('del.province'))}</label>
            <select id="delFP"><option value="all">${esc(T('exp.all'))}</option>${provinces.map(pv=> `<option value="${esc(pv)}" ${delFilter.province===pv?'selected':''}>${esc(pv)}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('del.region'))}</label>
            <select id="delFR"><option value="all">${esc(T('exp.all'))}</option>${regionKeys().map(k=> `<option value="${k}" ${delFilter.region===k?'selected':''}>${esc(T('region.'+k))}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('del.status'))}</label>
            <select id="delFS"><option value="all">${esc(T('exp.all'))}</option>${dStatuses.map(st=> `<option value="${esc(st.name)}" ${delFilter.status===st.name?'selected':''}>${esc(itemLabel(st))}</option>`).join('')}</select>
          </div>
          <button class="btn btn-ghost" id="delClear">${esc(T('exp.clearFilter'))}</button>
        </div>
        <div class="del-table-wrap">
        <table class="art-table">
          <thead><tr>
            <th>${esc(T('exp.date'))}</th><th>${esc(T('del.orderNo'))}</th><th>${esc(T('del.recipient'))}</th>
            <th>${esc(T('del.province'))}</th><th>${esc(T('del.region'))}</th>
            <th>${esc(T('del.address'))}</th><th>${esc(T('del.shipType'))}</th><th>${esc(T('del.responsible'))}</th><th>${esc(T('del.proof'))}</th><th>${esc(T('del.status'))}</th><th class="del-sticky-date">${esc(T('del.deliveryDate'))}</th><th class="del-sticky-ver">${esc(T('del.verified'))}</th>
          </tr></thead>
          <tbody>${filtered.length ? filtered.map(r=> deliveryRow(r, dStatuses)).join('') : `<tr><td colspan="12" class="art-empty">${esc(T('del.empty'))}</td></tr>`}</tbody>
        </table>
        </div>
      </div>`;
    body.querySelector('#delFrom').addEventListener('change', e=>{ delFilter.from = e.target.value; renderDeliveryPage(body); });
    body.querySelector('#delTo').addEventListener('change', e=>{ delFilter.to = e.target.value; renderDeliveryPage(body); });
    body.querySelector('#delClear').addEventListener('click', ()=>{ delFilter = { from:'', to:'', province:'all', region:'all', status:'all' }; renderDeliveryPage(body); });
    body.querySelector('#delFP').addEventListener('change', e=>{ delFilter.province = e.target.value; renderDeliveryPage(body); });
    body.querySelector('#delFR').addEventListener('change', e=>{ delFilter.region   = e.target.value; renderDeliveryPage(body); });
    body.querySelector('#delFS').addEventListener('change', e=>{ delFilter.status   = e.target.value; renderDeliveryPage(body); });
    body.querySelectorAll('.del-status').forEach(sel=> sel.addEventListener('change', async ()=>{
      const d = deliveries.find(x=> x.id === sel.dataset.id); if(!d) return;
      d.status = sel.value; await saveDeliveries(); renderDeliveryPage(body);
    }));
    body.querySelectorAll('.del-date').forEach(inp=> inp.addEventListener('change', async ()=>{ const d = deliveries.find(x=> x.id === inp.dataset.vid); if(!d) return; d.deliveryDate = inp.value; await saveDeliveries(); }));
    body.querySelectorAll('.del-proof-btn').forEach(btn=> btn.addEventListener('click', ()=>{ const o=orders.find(x=> x.id===btn.dataset.oid); if(o && o.deliveryProof) openBill(o.deliveryProof); }));
    if((typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'verifyDelivery')){
      body.querySelectorAll('.del-verify[data-vid]').forEach(el=> el.addEventListener('click', async ()=>{
        const d = deliveries.find(x=> x.id === el.dataset.vid); if(!d) return;
        d.verified = !d.verified; d.verifiedBy = d.verified ? currentActorName() : '';
        await saveDeliveries(); renderDeliveryPage(body);
      }));
    }
  }
  function deliveryCardHtml(r){
    const o = r.o, d = r.d; const ap = o.addressParts || {};
    return `<div class="kcard" draggable="true" data-id="${esc(d.id)}" data-oid="${esc(o.id)}"><div class="kcard-actions"><button class="kcard-edit" title="${esc(T('edit'))}">\u270E</button></div><div class="kcard-inv">${esc(o.invoiceNumber||'-')}</div><div class="kcard-cust">${esc(o.customerName||'-')}</div><div class="kcard-foot"><span>${esc(ap.provinceName||'-')}</span><span class="art-pill" style="background:#5B8FB0; font-size:10px;">${esc(dispName('shippingTypes', o.deliveryMethod)||o.deliveryMethod||'-')}</span></div></div>`;
  }
  function drawDeliveryKanban(body){
    const container = body.querySelector('#delKanban'); if(!container) return;
    const statuses = config.deliveryStatuses || [];
    const rows = deliveries.map(d=> ({ d, o: orders.find(x=> x.id === d.orderId) })).filter(r=> r.o).filter(r=>{
      const ap = r.o.addressParts || {};
      if(delFilter.from && (r.o.date||'') < delFilter.from) return false;
      if(delFilter.to && (r.o.date||'') > delFilter.to) return false;
      if(delFilter.province !== 'all' && ap.provinceName !== delFilter.province) return false;
      return true;
    });
    container.innerHTML = statuses.map(st=>{
      const cards = rows.filter(r=> r.d.status === st.name);
      return `<div class="kcol" data-status="${esc(st.name)}"><div class="kcol-head"><span class="kcol-dot" style="background:${esc(st.color)}"></span><span>${esc(itemLabel(st))}</span><span class="kcol-count">${cards.length}</span></div><div class="kcol-body">${cards.length===0 ? `<div class="kcol-empty">${esc(T('kb.empty'))}</div>` : cards.map(r=> deliveryCardHtml(r)).join('')}</div></div>`;
    }).join('');
    container.querySelectorAll('.kcard').forEach(el=>{
      el.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', el.dataset.id); el.classList.add('dragging'); });
      el.addEventListener('dragend', ()=> el.classList.remove('dragging'));
      const eb = el.querySelector('.kcard-edit'); if(eb) eb.addEventListener('click', (e)=>{ e.stopPropagation(); const o = orders.find(x=> x.id===el.dataset.oid); if(o) openOrderModal(o, body, ()=> renderDeliveryKanban(body)); });
    });
    container.querySelectorAll('.kcol').forEach(col=>{
      col.addEventListener('dragover', e=>{ e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', ()=> col.classList.remove('drag-over'));
      col.addEventListener('drop', async e=>{
        e.preventDefault(); col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const newStatus = col.dataset.status;
        const d = deliveries.find(x=> x.id===id);
        if(d && d.status !== newStatus){ d.status = newStatus; await saveDeliveries(); drawDeliveryKanban(body); }
      });
    });
  }
  function renderDeliveryKanban(body){
    const all = deliveries.map(d=> ({ d, o: orders.find(x=> x.id === d.orderId) })).filter(r=> r.o);
    const provinces = [...new Set(all.map(r=> (r.o.addressParts||{}).provinceName).filter(Boolean))].sort();
    body.innerHTML = `<div class="panel"><div class="art-toolbar"><div class="art-field"><label>${esc(T('exp.from'))}</label><input type="date" id="dkFrom" value="${esc(delFilter.from)}"></div><div class="art-field"><label>${esc(T('exp.to'))}</label><input type="date" id="dkTo" value="${esc(delFilter.to)}"></div><div class="art-field"><label>${esc(T('del.province'))}</label><select id="dkProv"><option value="all">${esc(T('del.allProvinces'))}</option>${provinces.map(pv=> `<option value="${esc(pv)}" ${delFilter.province===pv?'selected':''}>${esc(pv)}</option>`).join('')}</select></div><button class="btn btn-ghost" id="dkClear">${esc(T('exp.clearFilter'))}</button></div><div class="art-kanban" id="delKanban"></div></div>`;
    body.querySelector('#dkFrom').addEventListener('change', e=>{ delFilter.from=e.target.value; drawDeliveryKanban(body); });
    body.querySelector('#dkTo').addEventListener('change', e=>{ delFilter.to=e.target.value; drawDeliveryKanban(body); });
    body.querySelector('#dkProv').addEventListener('change', e=>{ delFilter.province=e.target.value; drawDeliveryKanban(body); });
    body.querySelector('#dkClear').addEventListener('click', ()=>{ delFilter={from:'',to:'',province:'all',region:'all',status:'all'}; renderDeliveryKanban(body); });
    drawDeliveryKanban(body);
  }
  const _MONTHS_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const _MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const _WEEKDAYS_TH = ['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'];
  const _WEEKDAYS_EN = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  function _monthLabel(date){ const en=(window.appLang&&window.appLang())==='en'; return (en?_MONTHS_EN:_MONTHS_TH)[date.getMonth()] + ' ' + date.getFullYear(); }
  function _delMonthMatrix(date){
    const y=date.getFullYear(), m=date.getMonth();
    const dim=new Date(y,m+1,0).getDate();
    let off=new Date(y,m,1).getDay()-1; if(off<0) off=6;
    const cells=[];
    for(let i=0;i<off;i++) cells.push(null);
    for(let d=1; d<=dim; d++){ cells.push({ day:d, iso:`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` }); }
    while(cells.length%7!==0) cells.push(null);
    return cells;
  }
  function drawDeliveryCalendar(body){
    const grid=body.querySelector('#delCalGrid'); if(!grid) return;
    const dStatuses = config.deliveryStatuses || [];
    const statusColor = (name)=> (dStatuses.find(sx=> sx.name===name)||{}).color || '#888';
    const chipColorOf = (r)=>{ if(delCalColorBy==='type'){ const st=(config.shippingTypes||[]).find(s=> s.name===r.o.deliveryMethod); return (st&&st.color)||'#888'; } if(delCalColorBy==='driver'){ return (config.driverColors||{})[r.o.deliveryResponsible] || '#8A8F80'; } return statusColor(r.d.status); };
    const all = deliveries.map(d=> ({ d, o: orders.find(x=> x.id === d.orderId) })).filter(r=> r.o).filter(r=>{
      if(delCalFilter.type!=='all' && r.o.deliveryMethod !== delCalFilter.type) return false;
      if(delCalFilter.driver!=='all' && r.o.deliveryResponsible !== delCalFilter.driver) return false;
      return true;
    });
    const scheduled = all.filter(r=> r.d.deliveryDate);
    const unsched = all.length - scheduled.length;
    const lbl=body.querySelector('#dcLabel'); if(lbl) lbl.textContent=_monthLabel(delCalDate);
    const un=body.querySelector('#dcUnsched'); if(un) un.textContent = unsched ? T('cal.unscheduled').replace('{n}', unsched) : '';
    const todayIso = (window.localIso ? window.localIso() : new Date().toISOString().slice(0,10));
    const canSet = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'setDeliveryDate');
    grid.innerHTML = _delMonthMatrix(delCalDate).map(cell=>{
      if(!cell) return `<div class="cal-cell empty"></div>`;
      const items = scheduled.filter(r=> r.d.deliveryDate === cell.iso);
      return `<div class="cal-cell ${cell.iso===todayIso?'today':''}" data-iso="${cell.iso}"><div class="cal-daynum">${cell.day}</div><div class="cal-cell-chips">${items.map(r=> `<div class="cal-chip del-cal-chip" ${canSet?'draggable="true"':''} data-oid="${esc(r.o.id)}" data-vid="${esc(r.d.id)}" style="background:${chipColorOf(r)}" title="${esc(itemLabel(dStatuses.find(sx=> sx.name===r.d.status)))} \u00B7 ${esc(dispName('shippingTypes', r.o.deliveryMethod)||'')} \u00B7 ${esc(r.o.deliveryResponsible||'-')}"><div class="cal-chip-topic">${esc(r.o.invoiceNumber||'-')}</div><div class="cal-chip-sub">${esc(r.o.customerName||'-')}${r.o.deliveryResponsible?' \u00B7 '+esc(r.o.deliveryResponsible):''}</div></div>`).join('')}</div></div>`;
    }).join('');
    grid.querySelectorAll('.del-cal-chip').forEach(ch=>{
      ch.addEventListener('click', ()=>{ const o=orders.find(x=> x.id===ch.dataset.oid); if(o) openOrderModal(o, body, ()=> renderDeliveryCalendar(body)); });
      if(canSet){
        ch.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', ch.dataset.vid); ch.classList.add('dragging'); });
        ch.addEventListener('dragend', ()=> ch.classList.remove('dragging'));
      }
    });
    if(canSet){
      grid.querySelectorAll('.cal-cell[data-iso]').forEach(cell=>{
        cell.addEventListener('dragover', e=>{ e.preventDefault(); cell.classList.add('drag-over'); });
        cell.addEventListener('dragleave', ()=> cell.classList.remove('drag-over'));
        cell.addEventListener('drop', async e=>{
          e.preventDefault(); cell.classList.remove('drag-over');
          const vid = e.dataTransfer.getData('text/plain');
          const d = deliveries.find(x=> x.id===vid);
          if(d && d.deliveryDate !== cell.dataset.iso){ d.deliveryDate = cell.dataset.iso; await saveDeliveries(); drawDeliveryCalendar(body); }
        });
      });
    }
  }
  function renderDeliveryCalendar(body){
    if(!delCalDate){ const t=new Date(); delCalDate=new Date(t.getFullYear(), t.getMonth(), 1); }
    const en=(window.appLang&&window.appLang())==='en';
    const all = deliveries.map(d=> ({ d, o: orders.find(x=> x.id === d.orderId) })).filter(r=> r.o);
    const drivers = [...new Set(all.map(r=> r.o.deliveryResponsible).filter(Boolean))].sort();
    const types = config.shippingTypes || [];
    const wk = (en?_WEEKDAYS_EN:_WEEKDAYS_TH).map(w=> `<span>${esc(w)}</span>`).join('');
    body.innerHTML = `<div class="panel">
      <div class="art-toolbar">
        <div class="art-field"><label>${esc(T('cal.driverType'))}</label><select id="dcType"><option value="all">${esc(T('cal.allTypes'))}</option>${types.map(st=> `<option value="${esc(st.name)}" ${delCalFilter.type===st.name?'selected':''}>${esc(itemLabel(st))}</option>`).join('')}</select></div>
        <div class="art-field"><label>${esc(T('cal.driver'))}</label><select id="dcDriver"><option value="all">${esc(T('cal.allDrivers'))}</option>${drivers.map(dv=> `<option value="${esc(dv)}" ${delCalFilter.driver===dv?'selected':''}>${esc(dv)}</option>`).join('')}</select></div>
        <div class="art-field"><label>${esc(T('cal.colorBy'))}</label><div class="del-seg" id="dcColorBy"><button type="button" class="del-seg-btn ${delCalColorBy==='status'?'active':''}" data-cb="status">${esc(T('cal.byStatus'))}</button><button type="button" class="del-seg-btn ${delCalColorBy==='type'?'active':''}" data-cb="type">${esc(T('cal.byType'))}</button><button type="button" class="del-seg-btn ${delCalColorBy==='driver'?'active':''}" data-cb="driver">${esc(T('cal.byDriver'))}</button></div></div>
        <button class="btn btn-ghost" id="dcClear">${esc(T('exp.clearFilter'))}</button>
      </div>
      <div class="cal-toolbar">
        <button class="btn btn-ghost" id="dcPrev">\u2039</button>
        <span class="cal-label" id="dcLabel"></span>
        <button class="btn btn-ghost" id="dcNext">\u203A</button>
        <button class="btn btn-ghost" id="dcToday">${esc(T('cal.today'))}</button>
        <span class="del-cal-unsched" id="dcUnsched"></span>
      </div>
      <div class="calendar-weekdays">${wk}</div>
      <div class="calendar-grid" id="delCalGrid"></div>
    </div>`;
    body.querySelector('#dcType').addEventListener('change', e=>{ delCalFilter.type=e.target.value; drawDeliveryCalendar(body); });
    body.querySelector('#dcDriver').addEventListener('change', e=>{ delCalFilter.driver=e.target.value; drawDeliveryCalendar(body); });
    body.querySelectorAll('#dcColorBy .del-seg-btn').forEach(btn=> btn.addEventListener('click', ()=>{ delCalColorBy=btn.dataset.cb; body.querySelectorAll('#dcColorBy .del-seg-btn').forEach(b=> b.classList.toggle('active', b.dataset.cb===delCalColorBy)); drawDeliveryCalendar(body); }));
    body.querySelector('#dcClear').addEventListener('click', ()=>{ delCalFilter={type:'all',driver:'all'}; renderDeliveryCalendar(body); });
    body.querySelector('#dcPrev').addEventListener('click', ()=>{ delCalDate=new Date(delCalDate.getFullYear(), delCalDate.getMonth()-1, 1); drawDeliveryCalendar(body); });
    body.querySelector('#dcNext').addEventListener('click', ()=>{ delCalDate=new Date(delCalDate.getFullYear(), delCalDate.getMonth()+1, 1); drawDeliveryCalendar(body); });
    body.querySelector('#dcToday').addEventListener('click', ()=>{ const t=new Date(); delCalDate=new Date(t.getFullYear(), t.getMonth(), 1); drawDeliveryCalendar(body); });
    drawDeliveryCalendar(body);
  }
  function renderDriverColors(body){
    const emps = (typeof window.employeesByRoleType==='function' ? window.employeesByRoleType('driver') : []);
    const outs = config.outsources || [];
    const dc = config.driverColors || {};
    const rows = emps.map(e=> ({ name:e.name, label:e.name, kind:'our' })).concat(outs.map(o=> ({ name:o.name, label:itemLabel(o), kind:'outsource' })));
    body.innerHTML = `<div class="panel"><h3 class="art-form-section" style="margin-top:0;">${esc(T('drv.title'))}</h3><p class="setting-desc" style="margin-bottom:14px;">${esc(T('drv.desc'))}</p>${rows.length ? `<div class="art-set-list">${rows.map(r=> `<div class="drv-row"><span class="art-set-swatch" style="background:${esc(dc[r.name]||'#8A8F80')}"></span><span class="drv-name">${esc(r.label||r.name)}</span><span class="drv-kind">${esc(r.kind==='our'?T('drv.our'):T('drv.outsource'))}</span><input type="color" class="drv-color" data-name="${esc(r.name)}" value="${esc(dc[r.name]||'#8A8F80')}"></div>`).join('')}</div>` : `<p class="art-set-empty">${esc(T('drv.empty'))}</p>`}</div>`;
    body.querySelectorAll('.drv-color').forEach(inp=> inp.addEventListener('input', async ()=>{ config.driverColors = config.driverColors || {}; config.driverColors[inp.dataset.name] = inp.value; const sw = inp.closest('.drv-row').querySelector('.art-set-swatch'); if(sw) sw.style.background = inp.value; await saveConfig(); }));
  }
  function renderDeliveryConfig(body){
    const rerender = ()=> renderDeliveryConfig(body);
    const mode = regionMode();
    const toggle = `<div class="del-regionmode">
      <div class="del-region-title">${esc(T('set.regionMode'))}</div>
      <div class="del-seg">
        <button type="button" class="del-seg-btn ${mode==='4'?'active':''}" data-mode="4">${esc(T('set.region4'))}</button>
        <button type="button" class="del-seg-btn ${mode==='6'?'active':''}" data-mode="6">${esc(T('set.region6'))}</button>
      </div>
      <p class="setting-desc" style="margin-top:8px;">${esc(T('set.regionModeHint'))}</p>
    </div>`;
    body.innerHTML = renderConfigShell(toggle + groupHtml('deliveryStatuses', T('set.deliveryStatuses')) + groupHtml('shippingTypes', T('set.shippingTypes')) + groupHtml('outsources', T('set.outsources')));
    body.querySelectorAll('.del-seg-btn').forEach(btn=> btn.addEventListener('click', async ()=>{ config.regionMode = btn.dataset.mode; await saveConfig(); rerender(); }));
    wireGroups(body.querySelector('#artSetGroups'), body, rerender);
  }
  function defaultCatPrices(){ return {
    r4:{ north:2500, northeast:2000, central:1500, south:2000 },
    r6:{ north:2500, northeast:2000, central:1500, east:1800, west:1800, south:2300 },
    prov:{} }; }
  function defaultShippingCost(){
    const sc = { mode:'6', provMode:'exception', byCat:{} };
    ((config && config.productTypes) || []).forEach(t=> sc.byCat[t.name] = defaultCatPrices());
    return sc;
  }
  // Per-category shipping prices. Migrates the old flat r4/r6/prov → byCat (each category inherits the flat values).
  function seedShippingCost(){
    if(!config) return;
    let changed = false;
    if(!config.shippingCost){ config.shippingCost = defaultShippingCost(); changed = true; }
    const sc = config.shippingCost;
    if(!sc.byCat){
      const flat = { r4: sc.r4||{}, r6: sc.r6||{}, prov: sc.prov||{} };
      const hasFlat = Object.keys(flat.r4).length || Object.keys(flat.r6).length || Object.keys(flat.prov).length;
      sc.byCat = {};
      ((config.productTypes)||[]).forEach(t=> sc.byCat[t.name] = hasFlat ? { r4:{...flat.r4}, r6:{...flat.r6}, prov:{...flat.prov} } : defaultCatPrices());
      delete sc.r4; delete sc.r6; delete sc.prov; changed = true;
    }
    if(!sc.mode) sc.mode = '6';
    if(!sc.provMode) sc.provMode = 'exception';
    if(changed){ config.shipCostSeeded = true; saveConfig(); }
  }
  function scCatStore(){
    const sc = config.shippingCost;
    if(!sc.byCat) sc.byCat = {};
    if(!sc.byCat[shipCat]) sc.byCat[shipCat] = defaultCatPrices();
    return sc.byCat[shipCat];
  }
  function renderShippingCost(body){
    if(!config.shippingCost) config.shippingCost = defaultShippingCost();
    const sc = config.shippingCost;
    const cats = config.productTypes || [];
    if(!shipCat || !cats.some(c=> c.name===shipCat)) shipCat = (cats[0]||{}).name || '';
    const cs = scCatStore();
    if(!shipRegion) shipRegion = regionKeys()[0];
    const lang = (window.appLang && window.appLang()) || 'th';
    const catSel = `<select id="scCat" class="shipcost-region-pick">${cats.map(c=> `<option value="${esc(c.name)}" ${shipCat===c.name?'selected':''}>${esc(itemLabel(c))}</option>`).join('')}</select>`;
    const modeBtns = [['4',T('set.region4')],['6',T('set.region6')],['province',T('set.shipByProvince')]]
      .map(([m,lbl])=> `<button type="button" class="del-seg-btn ${sc.mode===m?'active':''}" data-scmode="${m}">${esc(lbl)}</button>`).join('');
    let inner='';
    if(sc.mode==='province'){
      const pmBtns = [['exception',T('set.shipException')],['manual',T('set.shipManual')]]
        .map(([m,lbl])=> `<button type="button" class="del-seg-btn ${(sc.provMode||'exception')===m?'active':''}" data-scpm="${m}">${esc(lbl)}</button>`).join('');
      inner = `<div class="del-region-title">${esc(T('set.shipProvSwitch'))}</div><div class="del-seg">${pmBtns}</div>
        <div class="del-region-title" style="margin-top:16px;">${esc(T('set.shipPickRegion'))}</div>
        <select id="scRegion" class="shipcost-region-pick">${regionKeys().map(k=> `<option value="${k}" ${shipRegion===k?'selected':''}>${esc(T('region.'+k))}</option>`).join('')}</select>
        <div id="scProvList" style="margin-top:14px;">${esc(T('rev.loading'))}</div>`;
    } else {
      const keys = sc.mode==='4' ? REGION_KEYS_4 : REGION_KEYS_6;
      const store = sc.mode==='4' ? cs.r4 : cs.r6;
      inner = `<div class="shipcost-list">` + keys.map(k=> `<div class="shipcost-row">
          <span class="shipcost-name"><i class="th-swatch th-sw-${k}"></i>${esc(T('region.'+k))}</span>
          <input type="number" class="sc-region-inp" data-region="${k}" value="${store[k]!=null?store[k]:''}" placeholder="0" min="0">
          <span class="shipcost-unit">${esc(T('set.baht'))}</span></div>`).join('') + `</div>`;
    }
    body.innerHTML = `<div class="panel settings-panel"><div class="settings-section">
      <div class="settings-section-head"><h3 class="setting-title">${esc(T('set.shipCost'))}</h3><p class="setting-desc">${esc(T('set.shipCostDesc'))}</p></div>
      <div class="del-region-title">${esc(T('set.shipCategory'))}</div>${catSel}
      <div class="del-region-title" style="margin-top:16px;">${esc(T('set.shipMode'))}</div><div class="del-seg">${modeBtns}</div>
      <div id="scInner" style="margin-top:18px;">${inner}</div>
    </div></div>`;
    body.querySelector('#scCat').addEventListener('change', e=>{ shipCat=e.target.value; renderShippingCost(body); });
    body.querySelectorAll('[data-scmode]').forEach(b=> b.addEventListener('click', async ()=>{ sc.mode=b.dataset.scmode; await saveConfig(); renderShippingCost(body); }));
    body.querySelectorAll('.sc-region-inp').forEach(inp=> inp.addEventListener('change', async ()=>{ const st=sc.mode==='4'?cs.r4:cs.r6; const v=parseFloat(inp.value); if(v>0) st[inp.dataset.region]=v; else delete st[inp.dataset.region]; await saveConfig(); }));
    if(sc.mode==='province'){
      body.querySelectorAll('[data-scpm]').forEach(b=> b.addEventListener('click', async ()=>{ sc.provMode=b.dataset.scpm; await saveConfig(); renderShippingCost(body); }));
      const rp=body.querySelector('#scRegion'); if(rp) rp.addEventListener('change', ()=>{ shipRegion=rp.value; renderShippingCost(body); });
      ensureThGeo().then(()=> fillScProv(body));
    }
  }
  function fillScProv(body){
    const box=body.querySelector('#scProvList'); if(!box || !window.__thGeo) return;
    const cs=scCatStore(), sc=config.shippingCost, lang=(window.appLang && window.appLang())||'th';
    const reg=shipRegion||regionKeys()[0];
    const provs=window.__thGeo.p.filter(pp=> regionOfProvince(pp[0])===reg);
    const baseStore=regionMode()==='4'?cs.r4:cs.r6, base=baseStore[reg];
    let html='';
    if((sc.provMode||'exception')==='exception'){
      html += `<div class="shipcost-row shipcost-base"><span class="shipcost-name">${esc(T('set.shipRegionBase'))} · ${esc(T('region.'+reg))}</span>
        <input type="number" class="sc-base-inp" data-region="${reg}" value="${base!=null?base:''}" placeholder="0" min="0"><span class="shipcost-unit">${esc(T('set.baht'))}</span></div>`;
    }
    html += provs.map(pp=>{ const nm=lang==='en'?pp[2]:pp[1]; const ph=((sc.provMode||'exception')==='exception' && base!=null)?String(base):'0';
      return `<div class="shipcost-row"><span class="shipcost-name">${esc(nm)}</span><input type="number" class="sc-prov-inp" data-code="${pp[0]}" value="${cs.prov[pp[0]]!=null?cs.prov[pp[0]]:''}" placeholder="${esc(ph)}" min="0"><span class="shipcost-unit">${esc(T('set.baht'))}</span></div>`; }).join('');
    box.innerHTML=html;
    box.querySelectorAll('.sc-base-inp').forEach(inp=> inp.addEventListener('change', async ()=>{ const st=regionMode()==='4'?cs.r4:cs.r6; const v=parseFloat(inp.value); if(v>0) st[inp.dataset.region]=v; else delete st[inp.dataset.region]; await saveConfig(); fillScProv(body); }));
    box.querySelectorAll('.sc-prov-inp').forEach(inp=> inp.addEventListener('change', async ()=>{ const v=parseFloat(inp.value); if(v>0) cs.prov[inp.dataset.code]=v; else delete cs.prov[inp.dataset.code]; await saveConfig(); }));
  }
  function makeStoreModule(cfg){
    let sub = cfg.subpages[0];
    const mod = {
      id: cfg.id,
      navLabel: cfg.navLabel,
      pageId: 'page-' + cfg.id,
      async onInit(){ await ensureLoaded(); },
      mount(container){
        const lang = (window.appLang && window.appLang()) || 'th';
        container.innerHTML = `
          <div class="topbar">
            <h1>${esc(cfg.navLabel[lang] || cfg.navLabel.en)}</h1>
            <div class="crumb">${esc(T('crumb'))}</div>
          </div>
          <div class="content">
            <div class="acc-subnav store-subnav" id="${cfg.id}Subnav"></div>
            <div id="${cfg.id}Body"></div>
          </div>`;
        container.querySelector('#' + cfg.id + 'Subnav').addEventListener('click', (e)=>{
          const btn = e.target.closest('[data-subpage]');
          if(!btn) return;
          sub = btn.dataset.subpage;
          _ehDetail = null;
          mod.render();
        });
      },
      render(){
        const nav = document.querySelector('#' + cfg.id + 'Subnav');
        const body = document.querySelector('#' + cfg.id + 'Body');
        if(!nav || !body) return;
        nav.innerHTML = cfg.subpages.length > 1
          ? cfg.subpages.map(id=> `<button type="button" class="acc-subnav-btn ${id===sub?'active':''}" data-subpage="${id}">${esc(T('nav.'+id))}</button>`).join('')
          : '';
        renderSubpage(sub, body);
      }
    };
    if(cfg.dataTools) mod.dataTools = cfg.dataTools;
    return mod;
  }

  window.registerModule(makeStoreModule({ id:'stock',           navLabel:{ th:'จัดการสต๊อก', en:'Stock Management' },  subpages:['products','stockHistory','productHistory'] }));
  window.registerModule(makeStoreModule({ id:'sell',            navLabel:{ th:'การขาย',       en:'Sell Management' },   subpages:['revenue','orderStatus','invoiceStatus','orderHistory'] }));
  window.registerModule(makeStoreModule({ id:'accounting',      navLabel:{ th:'บัญชี',         en:'Accounting' },        subpages:['expense','summary','ledger','account','vat','deleted','acctConfig'], dataTools:_dataTools }));
  window.registerModule(makeStoreModule({ id:'businessProfile', navLabel:{ th:'ข้อมูลธุรกิจ',   en:'Business Profile' },  subpages:['profile'] }));
  window.registerModule(makeStoreModule({ id:'sellStockSetting', navLabel:{ th:'ตั้งค่า Sell/Stock', en:'Sell/Stock Setting' }, subpages:['sellConfig','stockConfig'] }));
  window.registerModule(makeStoreModule({ id:'delivery',        navLabel:{ th:'การจัดส่ง',      en:'Delivery' },         subpages:['deliveryList','deliveryBoard','deliveryCalendar','deliveryDrivers'] }));
  window.registerModule(makeStoreModule({ id:'deliverySetting', navLabel:{ th:'ตั้งค่าการจัดส่ง', en:'Delivery Setting' }, subpages:['grouping','shippingCost'] }));

  /* ================= Export / Import (JSON) ================= */
  function exportStoreJson(){
    const blob = { app:'simplestore', schema:1, config, expenses, orders, products, stockLog, lots, promotions };
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
    lots      = Array.isArray(data.lots)      ? data.lots      : [];
    promotions = Array.isArray(data.promotions) ? data.promotions : [];
    migrateConfigRoles();
    await migrateStockLots();
    await saveConfig();
    await window.Store.set(K_EXPENSES, expenses);
    await window.Store.set(K_ORDERS, orders);
    await window.Store.set(K_PRODUCTS, products);
    await window.Store.set(K_STOCKLOG, stockLog);
    await window.Store.set(K_LOTS, lots);
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
    const prefix = (config.prefixes && config.prefixes.expense) || 'CSA';
    return `${prefix}-${code}-${letter}${String(nextSeq('expense', dateStr)).padStart(3,'0')}`;
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
              ${tags.map(t=> `<option value="${esc(t.name)}" ${expFilter.tag===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}
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
          <label>${esc(T('exp.tag'))}<select id="mTag" ${canChange('changeExpenseTag')?'':'disabled'}>${tags.map(t=> `<option value="${esc(t.name)}" ${row&&row.tag===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select></label>
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
        <div class="art-sum-split">
          <div class="art-sum-half">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('sum.byCategory'))}</h4>
            <div class="art-sum-chart" id="artCostCatDonut"></div>
          </div>
          <div class="art-sum-half">
            <h4 class="art-form-section" style="margin-top:0;">${esc(T('sum.byOrigin'))}</h4>
            <div class="art-sum-chart" id="artCostOriginDonut"></div>
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
    renderCostDonuts(body);
  }

  // Stock cost (lot cost x qty in) split by product category and by cost origin.
  function renderCostDonuts(body){
    const inPeriod = (l)=> summaryMonth === 'all' || expMonthKey(l.date || '') === summaryMonth;
    const catTotals = {}, originTotals = {};
    lots.filter(inPeriod).forEach(l=>{
      const value = (Number(l.cost)||0) * (l.qtyIn||0);
      if(value <= 0) return;
      const prod = products.find(p=> p.id === l.productId);
      const cat = (prod && prod.productType) || T('sum.uncategorised');
      catTotals[cat] = (catTotals[cat]||0) + value;
      const org = l.origin || T('sum.noOrigin');
      originTotals[org] = (originTotals[org]||0) + value;
    });
    const catItems = Object.keys(catTotals).map(name=> ({ name: dispName('productTypes', name), color: ptypeColor(name) }));
    const catVals = {}; Object.keys(catTotals).forEach(name=>{ catVals[dispName('productTypes', name)] = catTotals[name]; });
    const orgItems = Object.keys(originTotals).map(name=> ({ name, color: originColor(name) }));
    const catGrand = Object.values(catTotals).reduce((a,b)=> a+b, 0);
    const orgGrand = Object.values(originTotals).reduce((a,b)=> a+b, 0);
    renderSummaryDonut(body.querySelector('#artCostCatDonut'), catItems, catVals, catGrand);
    renderSummaryDonut(body.querySelector('#artCostOriginDonut'), orgItems, originTotals, orgGrand);
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
    const inc = orders.filter(isPaidOrder).map(o=>{
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

  // VAT Calculation — every Ledger entry with the same 3-way mode the Monthly
  // Report uses (shared state: acctVatMode + o.vatable), so ticking here shows up there.
  function renderDeletedPage(body){
    const can = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'restoreDeleted');
    const pill = (kind, id)=> `<span class="art-pill del-restore ${can?'del-restore-btn':''}" data-kind="${kind}" data-id="${esc(id)}" style="background:${can?'#6B8F71':'#8A8F80'};">${esc(T('bin.restore'))}</span>`;
    const stamp = (r)=> esc((r.deletedBy||'-') + (r.deletedAt ? ' \u00B7 ' + _fmtEditedAt(r.deletedAt) : ''));
    const prodRows = deletedProducts.slice().sort((a,b)=> String(b.deletedAt||'').localeCompare(String(a.deletedAt||''))).map(p=> `<tr>
        <td class="art-id">${esc(p.sku||'-')}</td>
        <td>${esc(p.name||'-')}</td>
        <td>${esc(dispName('productTypes', p.productType)||'-')}</td>
        <td class="num">${fmt(p.price)}</td>
        <td class="num">${(p._lots||[]).reduce((sm,l)=> sm + (l.qtyIn||0), 0) || '-'}</td>
        <td class="num">${fmt((p._lots||[]).reduce((sm,l)=> sm + (Number(l.cost)||0) * (l.qtyIn||0), 0))}</td>
        <td class="num">${(p._expenses||[]).length || '-'}</td>
        <td class="art-edited">${stamp(p)}</td>
        <td>${pill('product', p.id)}</td>
      </tr>`).join('');
    const orderRows = deletedOrders.slice().sort((a,b)=> String(b.deletedAt||'').localeCompare(String(a.deletedAt||''))).map(o=>{
      const c = computeOrder(o);
      return `<tr>
        <td>${esc(acctDate(o.date))}</td>
        <td class="art-id">${esc(o.invoiceNumber||'-')}</td>
        <td>${esc(o.customerName||'-')}</td>
        <td class="num">${fmt(c.net)}</td>
        <td class="art-edited">${stamp(o)}</td>
        <td>${pill('order', o.id)}</td>
      </tr>`;
    }).join('');
    body.innerHTML = `
      <div class="panel">
        <p class="setting-desc" style="margin-top:0;">${esc(T('bin.desc'))}</p>
        <h4 class="art-form-section">${esc(T('bin.products'))} (${deletedProducts.length})</h4>
        <div class="art-table-wrap"><table class="art-table">
          <thead><tr><th>${esc(T('prod.sku'))}</th><th>${esc(T('prod.name'))}</th><th>${esc(T('prod.ptype'))}</th><th class="num">${esc(T('prod.price'))}</th><th class="num">${esc(T('bin.qty'))}</th><th class="num">${esc(T('bin.lotValue'))}</th><th class="num">${esc(T('bin.expenses'))}</th><th>${esc(T('bin.deletedBy'))}</th><th></th></tr></thead>
          <tbody>${prodRows || `<tr><td colspan="9" class="art-empty">${esc(T('bin.empty'))}</td></tr>`}</tbody>
        </table></div>
        <h4 class="art-form-section">${esc(T('bin.orders'))} (${deletedOrders.length})</h4>
        <div class="art-table-wrap"><table class="art-table">
          <thead><tr><th>${esc(T('exp.date'))}</th><th>${esc(T('rev.invoiceNo'))}</th><th>${esc(T('rev.customer'))}</th><th class="num">${esc(T('exp.net'))}</th><th>${esc(T('bin.deletedBy'))}</th><th></th></tr></thead>
          <tbody>${orderRows || `<tr><td colspan="6" class="art-empty">${esc(T('bin.empty'))}</td></tr>`}</tbody>
        </table></div>
      </div>`;
    if(!can) return;
    body.querySelectorAll('.del-restore-btn').forEach(btn=> btn.addEventListener('click', async ()=>{
      if(!window.confirm(T('bin.confirm'))) return;
      const id = btn.dataset.id;
      if(btn.dataset.kind === 'product'){
        const rec = deletedProducts.find(x=> x.id === id); if(!rec) return;
        delete rec.deletedAt; delete rec.deletedBy;
        const back = Array.isArray(rec._lots) ? rec._lots : [];
        const backExp = Array.isArray(rec._expenses) ? rec._expenses : [];
        delete rec._lots; delete rec._expenses;
        products.push(rec);
        deletedProducts = deletedProducts.filter(x=> x.id !== id);
        if(back.length){ lots = lots.concat(back.filter(l=> !lots.some(x=> x.id === l.id))); await saveLots(); }
        if(backExp.length){ expenses = expenses.concat(backExp.filter(e=> !expenses.some(x=> x.id === e.id))); await saveExpenses(); }
        await saveProducts(); await saveDeletedProducts();
      }else{
        const rec = deletedOrders.find(x=> x.id === id); if(!rec) return;
        delete rec.deletedAt; delete rec.deletedBy;
        orders.push(rec);
        deletedOrders = deletedOrders.filter(x=> x.id !== id);
        await saveOrders(); await saveDeletedOrders();
      }
      renderDeletedPage(body);
    }));
  }
  function renderVatPage(body){
    const list = orders.filter(isPaidOrder).map(computeOrder).sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
    const showChk = acctVatMode === 'ticked';
    const rows = list.map(o=>{
      const on = acctVatMode==='all' ? true : (acctVatMode==='ticked' ? !!o.vatable : false);
      const vat = on ? acctVatOf(o.net) : 0;
      const base = o.net - vat;
      return `<tr data-id="${esc(o.id)}">
        <td>${esc(acctDate(o.date))}</td>
        <td class="art-id">${esc(o.invoiceNumber||'-')}</td>
        <td>${esc(o.customerName||'-')}</td>
        ${showChk ? `<td class="c"><input type="checkbox" class="vat-chk" ${o.vatable?'checked':''}></td>` : ''}
        <td class="num">${fmt(o.net)}</td>
        <td class="num">${fmt(base)}</td>
        <td class="num ${vat?'art-vat-amt':''}">${vat ? fmt(vat) : '-'}</td>
      </tr>`;
    }).join('');
    const totNet = list.reduce((sm,o)=> sm + o.net, 0);
    const totVat = list.reduce((sm,o)=>{
      const on = acctVatMode==='all' ? true : (acctVatMode==='ticked' ? !!o.vatable : false);
      return sm + (on ? acctVatOf(o.net) : 0);
    }, 0);
    body.innerHTML = `
      <div class="panel">
        <div class="art-vat-switch">
          <span class="art-vat-label">${esc(T('acct.vatMode'))}</span>
          <div class="art-vat-seg" id="vatSeg">
            <button type="button" data-vm="none" class="${acctVatMode==='none'?'active':''}">${esc(T('acct.vatNone'))}</button>
            <button type="button" data-vm="ticked" class="${acctVatMode==='ticked'?'active':''}">${esc(T('acct.vatTicked'))}</button>
            <button type="button" data-vm="all" class="${acctVatMode==='all'?'active':''}">${esc(T('acct.vatAll'))}</button>
          </div>
        </div>
        <div class="art-sum-cards">
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('vat.totalNet'))}</div><div class="art-stat-value">${fmt(totNet)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('vat.totalBase'))}</div><div class="art-stat-value">${fmt(totNet - totVat)} ฿</div></div>
          <div class="art-stat-card"><div class="art-stat-label">${esc(T('vat.totalVat'))}</div><div class="art-stat-value">${fmt(totVat)} ฿</div></div>
        </div>
        <div class="art-table-wrap">
          <table class="art-table">
            <thead><tr>
              <th>${esc(T('exp.date'))}</th><th>${esc(T('rev.invoiceNo'))}</th><th>${esc(T('rev.customer'))}</th>
              ${showChk ? `<th class="c">${esc(T('acct.vatable'))}</th>` : ''}
              <th class="num">${esc(T('exp.net'))}</th><th class="num">${esc(T('vat.base'))}</th><th class="num">${esc(T('vat.amount'))}</th>
            </tr></thead>
            <tbody>${list.length ? rows : `<tr><td colspan="${showChk?7:6}" class="art-empty">${esc(T('rev.empty'))}</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
    body.querySelectorAll('#vatSeg [data-vm]').forEach(b=> b.addEventListener('click', ()=>{ acctVatMode = b.dataset.vm; renderVatPage(body); }));
    body.querySelectorAll('.vat-chk').forEach(chk=> chk.addEventListener('change', async ()=>{
      const id = chk.closest('tr').dataset.id;
      const o = orders.find(x=> x.id === id); if(!o) return;
      o.vatable = chk.checked;
      await saveOrders(); renderVatPage(body);
    }));
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
    const dAmt=(base,val,type)=> (type==='percent'? base*(Math.abs(val)||0)/100 : Math.abs(val)||0);
    const itemsTotal = (o.items||[]).reduce((s,it)=> s + (it.qty*it.price), 0);
    const itemsNet = (o.items||[]).reduce((s,it)=>{ const gr=(it.qty||0)*(it.price||0); return s + (gr - dAmt(gr, it.discount, it.discountType)); }, 0);
    const shipping = o.shippingCost||0;
    const sub = itemsNet + shipping;
    const overallAmt = dAmt(sub, o.overallDiscount, o.overallDiscountType);
    const net = sub - overallAmt;
    return { ...o, itemsTotal, itemsNet, itemDiscTotal: itemsTotal - itemsNet, shipping, overallAmt, net };
  }
  // Running numbers come from a COUNTER kept on config, never from "how many
  // records exist today" — deleting a record must not free its number for reuse.
  // The counter resets to 1 on a new date.
  function nextSeq(kind, dateStr){
    if(!config.counters) config.counters = {};
    const cur = config.counters[kind];
    const n = (cur && cur.date === dateStr) ? (cur.n || 0) + 1 : 1;
    config.counters[kind] = { date: dateStr, n };
    saveConfig();
    return n;
  }
  function generateInvoiceNumber(dateStr, excludeId){
    const [y,m,d] = dateStr.split('-').map(Number);
    const code = dateHashCode(d, m, y);
    const prefix = (config.prefixes && config.prefixes.order) || 'ATSC';
    return `${prefix}-${code}-${String(nextSeq('order', dateStr)).padStart(3,'0')}`;
  }
  // Cost of goods sold for one order = what the allocated cost lots actually cost.
  function orderCOGS(o){
    return (o.items||[]).reduce((sm,it)=>
      sm + (it.costAllocation||[]).reduce((x,a)=> x + (Number(a.cost)||0) * (a.qty||0), 0), 0);
  }
  // Gross profit: revenue on the bill minus that cost. Delivery fuel/labour is
  // NOT in here yet (parked in the To-Do list).
  function orderProfit(o){ const c = computeOrder(o); return c.net - orderCOGS(o); }
  function itemsSummary(items){ return (items||[]).map(it=>{ const c = itemColorLabel(it); return `${it.productName}${c?' ('+c+')':''} x${it.qty}`; }).join(', '); }
  function ordColor(group, name){ return colorOf(group, name); }
  async function saveOrders(){ await window.Store.set(K_ORDERS, orders); syncDeliveries(); syncPublicStock(); }
  async function saveDeliveries(){ await window.Store.set(K_DELIVERIES, deliveries); }

  function ordersFiltered(){
    return orders.filter(o=>{
      if(_ledgerMode && !isPaidOrder(o)) return false;   // Ledger = paid invoices only
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
            <select id="ordOsFilter"><option value="all">${esc(T('exp.all'))}</option>${oStatuses.map(s=>`<option value="${esc(s.name)}" ${ordFilter.orderStatus===s.name?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('rev.invoiceStatus'))}</label>
            <select id="ordIsFilter"><option value="all">${esc(T('exp.all'))}</option>${iStatuses.map(s=>`<option value="${esc(s.name)}" ${ordFilter.invoiceStatus===s.name?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select>
          </div>
          <div class="art-field"><label>${esc(T('exp.tag'))}</label>
            <select id="ordTagFilter"><option value="all">${esc(T('exp.all'))}</option>${rTags.map(t=>`<option value="${esc(t.name)}" ${ordFilter.tag===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select>
          </div>
          <button class="btn btn-ghost" id="ordClearFilter">${esc(T('exp.clearFilter'))}</button>
          <div class="art-spacer"></div>
          ${_ledgerMode ? '' : `<button class="btn btn-primary" id="ordAdd">${esc(T('rev.add'))}</button>`}
        </div>
        <div class="art-table-wrap">
          <table class="art-table${_ledgerMode?' led-table':''}" id="ordTable">
            <thead><tr>
              <th>${esc(T('exp.date'))}</th><th>${esc(T('rev.invoiceNo'))}</th><th>${esc(T('rev.customer'))}</th>
              <th>${esc(T('rev.platform'))}</th><th>${esc(T('rev.items'))}</th><th class="num">${esc(T('exp.discount'))}</th>
              <th class="num">${esc(T('exp.net'))}</th><th>${esc(T('exp.tag'))}</th>
              <th>${esc(T('rev.orderStatus'))}</th><th>${esc(T('rev.invoiceStatus'))}</th><th>${esc(T('rev.deliveryMethod'))}</th><th>${esc(T('rev.responsible'))}</th><th>${esc(T('col.lastEdited'))}</th>${_ledgerMode ? `<th class="num">${esc(T('acct.cogs'))}</th><th class="num">${esc(T('acct.profit'))}</th><th class="c led-sticky-vat">${esc(T('acct.vatable'))}</th><th class="led-sticky-ver">${esc(T('del.verified'))}</th>` : ''}<th class="art-sticky-actions"></th>
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
    const _ordAdd = body.querySelector('#ordAdd');
    if(_ordAdd) _ordAdd.addEventListener('click', ()=> openOrderModal(null, body, ()=> renderRevenuePage(body)));
    renderOrdersTable(body);
  }

  function ledgerVerifyPill(o){
    const on = !!o.verified;
    const can = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'verifyLedger');
    return `<span class="art-pill led-verify ${can?'led-verify-btn':''}" style="background:${on?'#6B8F71':'#C6432E'};">${esc(on?T('sh.verYes'):T('sh.verNo'))}</span>${(on && o.verifiedBy) ? ` <span class="sh-verify-by">${esc(o.verifiedBy)}</span>` : ''}`;
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
          <td>${_ledgerMode
            ? `<span class="art-pill" style="background:${tagC}">${esc(dispName('revenueTags', o.tag))}</span>`
            : `<select class="art-inline-sel" data-field="tag" style="background:${tagC}">${rTags.map(t=>`<option value="${esc(t.name)}" ${t.name===o.tag?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select>`}</td>
          <td>${_ledgerMode
            ? `<span class="art-pill" style="background:${osC}">${esc(dispName('orderStatuses', o.orderStatus))}</span>`
            : `<select class="art-inline-sel" data-field="orderStatus" style="background:${osC}">${oStatuses.map(s=>`<option value="${esc(s.name)}" ${s.name===o.orderStatus?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select>`}</td>
          <td>${_ledgerMode
            ? `<span class="art-pill" style="background:${isC}">${esc(dispName('invoiceStatuses', o.invoiceStatus))}</span>`
            : `<select class="art-inline-sel" data-field="invoiceStatus" style="background:${isC}">${iStatuses.map(s=>`<option value="${esc(s.name)}" ${s.name===o.invoiceStatus?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select>`}</td>
          <td>${esc(o.deliveryMethod||'-')}</td>
          <td>${esc(o.deliveryResponsible||'-')}</td>
          <td class="art-edited">${esc(editedLabel(o))}</td>
          ${_ledgerMode ? `<td class="num">${fmt(orderCOGS(o))}</td><td class="num art-profit ${orderProfit(o) < 0 ? 'art-neg' : ''}">${fmt(orderProfit(o))}</td><td class="c led-sticky-vat"><input type="checkbox" class="led-vat-chk" ${o.vatable?'checked':''}></td><td class="led-sticky-ver">${ledgerVerifyPill(o)}</td>` : ''}
          <td class="art-sticky-actions"><div class="art-row-actions">
            <button class="acc-icon art-ord-doc" title="${esc(T('doc.rv.title'))}">📄</button>
            ${_ledgerMode ? '' : `<button class="acc-icon art-ord-edit" title="${esc(T('edit'))}">✎</button>
            <button class="acc-icon art-ord-del" title="${esc(T('delete'))}">✕</button>`}
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
        const _vc = tr.querySelector('.led-vat-chk');
        if(_vc) _vc.addEventListener('change', async ()=>{
          const o = orders.find(x=> x.id === id); if(!o) return;
          o.vatable = _vc.checked;
          await saveOrders(); renderOrdersTable(body);
        });
        const _vp = tr.querySelector('.led-verify-btn');
        if(_vp) _vp.addEventListener('click', async ()=>{
          const o = orders.find(x=> x.id === id); if(!o) return;
          o.verified = !o.verified; o.verifiedBy = o.verified ? currentActorName() : '';
          await saveOrders(); renderOrdersTable(body);
        });
        const _edb = tr.querySelector('.art-ord-edit');
        if(_edb) _edb.addEventListener('click', ()=> openOrderModal(orders.find(o=>o.id===id), body, ()=> renderRevenuePage(body)));
        const _delb = tr.querySelector('.art-ord-del');
        if(_delb) _delb.addEventListener('click', async ()=>{
          if(!window.confirm(T('rev.delConfirm'))) return;
          const _od = orders.find(o=> o.id === id);
          if(_od){ logRec(orderLog, saveOrderLog, id, _od.invoiceNumber, 'delete', _od); deletedOrders.push(toBin(_od)); await saveDeletedOrders(); }
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
        <div class="doc-opt-block">
          <span class="doc-opt-label">${esc(T('doc.showDiscounts'))}</span>
          <label class="doc-check"><input type="checkbox" id="dvDiscItem" checked> ${esc(T('doc.discItem'))}</label>
          <label class="doc-check"><input type="checkbox" id="dvDiscShip" checked> ${esc(T('doc.discShip'))}</label>
          <label class="doc-check"><input type="checkbox" id="dvDiscOverall" checked> ${esc(T('doc.discOverall'))}</label>
        </div>
        <label class="art-form-full" style="display:block;margin-bottom:12px;">${esc(T('doc.language'))}
          <select id="dvLang">
            <option value="th" ${((window.appLang&&window.appLang())!=='en')?'selected':''}>${esc(T('doc.langTh'))}</option>
            <option value="en" ${((window.appLang&&window.appLang())==='en')?'selected':''}>${esc(T('doc.langEn'))}</option>
          </select>
        </label>
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
      const opts = { type, vat: vatBtn.classList.contains('on'), pay: ov.querySelector('#dvPay').value, lang: ov.querySelector('#dvLang').value, showItemDisc: ov.querySelector('#dvDiscItem').checked, showShipDisc: ov.querySelector('#dvDiscShip').checked, showOverallDisc: ov.querySelector('#dvDiscOverall').checked };
      const html = buildDocumentHtml(order, opts);
      const w = window.open('', '_blank');
      if(!w){ alert(T('doc.popupBlocked')); return; }
      w.document.open(); w.document.write(html); w.document.close();
      close();
    });
  }

  function buildDocumentHtml(order, opts){
    const def = DOCDEF[opts.type] || DOCDEF.rv;
    const T = window.moduleI18n(ID, opts.lang);   // TH/EN doc-language override
    const b = config.business || {};
    const bName = (opts.lang==='en' && b.nameEn) ? b.nameEn : (b.name||'');
    const bAddress = (opts.lang==='en' && b.addressEn) ? b.addressEn : (b.address||'');
    const co = computeOrder(order);
    let shipGross = co.shipping;
    if(order.shippingOverride == null){
      const cats=[...new Set((order.items||[]).map(it=>{ const pr=products.find(x=> x.id===it.productId); return pr?(pr.productType||''):''; }).filter(Boolean))];
      const inc = new Set(order.shipInclude || cats);
      shipGross = cats.filter(c=> inc.has(c)).reduce((s,c)=> s + shipCostFor(c, (order.addressParts||{}).provinceCode), 0);
    }
    const shipDiscTotal = shipGross - co.shipping;
    const totalDisc = (co.itemDiscTotal||0) + shipDiscTotal + (co.overallAmt||0);
    const anyDisc = opts.showItemDisc || opts.showShipDisc || opts.showOverallDisc;
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
      const saleNote = it.salePercent ? ` <span style="color:#C6432E;">(-${it.salePercent}%)</span>` : '';
      const _col = itemColorLabel(it);
      const colNote = _col ? ' <span style="color:#666;">\u00B7 '+esc2(_col)+'</span>' : '';
      return '<tr>'+
        '<td class="c">'+(i+1)+'</td>'+
        '<td>'+esc2(it.productName)+colNote+saleNote+'</td>'+
        '<td class="c">'+(it.qty||0)+'</td>'+
        '<td class="r">'+money2(it.price)+'</td>'+
        '<td class="r">'+money2(amt)+'</td>'+
      '</tr>';
    }).join('');
    const totalsRows =
      '<tr><td class="tl">'+esc(T('doc.subtotal'))+'</td><td class="r">'+money2(co.itemsTotal)+'</td></tr>'+
      '<tr><td class="tl">'+esc(T('doc.shipping'))+'</td><td class="r">'+money2(shipGross)+'</td></tr>'+
      (opts.showItemDisc && co.itemDiscTotal ? '<tr><td class="tl">'+esc(T('doc.itemDiscount'))+'</td><td class="r">-'+money2(co.itemDiscTotal)+'</td></tr>' : '')+
      (opts.showShipDisc && shipDiscTotal ? '<tr><td class="tl">'+esc(T('doc.shipDiscount'))+'</td><td class="r">-'+money2(shipDiscTotal)+'</td></tr>' : '')+
      (opts.showOverallDisc && co.overallAmt ? '<tr><td class="tl">'+esc(T('doc.overallDiscount'))+'</td><td class="r">-'+money2(co.overallAmt)+'</td></tr>' : '')+
      (anyDisc && totalDisc ? '<tr class="disc-total"><td class="tl">'+esc(T('doc.totalDiscount'))+'</td><td class="r">-'+money2(totalDisc)+'</td></tr>' : '')+
      (vatOn ? '<tr><td class="tl">'+esc(T('doc.beforeVat'))+'</td><td class="r">'+money2(beforeVat)+'</td></tr><tr><td class="tl">'+esc(T('doc.vat7'))+'</td><td class="r">'+money2(vatAmt)+'</td></tr>' : '')+
      '<tr class="grand"><td class="tl">'+esc(T('doc.grand'))+'</td><td class="r">฿'+money2(grand)+'</td></tr>';

    const logo = b.logo ? '<img class="biz-logo" src="'+esc2(b.logo)+'" alt="">' : '';
    const sign = b.signature ? '<img class="sig-img" src="'+esc2(b.signature)+'" alt="">' : '';
    const stamp = b.stamp ? '<img class="stamp-img" src="'+esc2(b.stamp)+'" alt="">' : '';

    return '<!DOCTYPE html><html lang="'+(opts.lang==='en'?'en':'th')+'"><head><meta charset="utf-8">'+
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
          '<div class="biz">'+logo+'<div><div class="biz-name">'+(bName?esc2(bName):esc(T('doc.yourStore')))+'</div>'+
            '<div class="biz-meta">'+nl2br(bAddress)+(b.phone?'<br>โทร. '+esc2(b.phone):'')+(b.taxId?'<br>เลขประจำตัวผู้เสียภาษี '+esc2(b.taxId):'')+'</div></div>'+
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
          '<div class="sign-box"><div class="sign-space">'+sign+stamp+'</div><div class="sign-line">'+esc(T(def.signR))+(bName?' · '+esc2(bName):'')+'</div></div>'+
        '</div>'+
        '<div class="note">'+esc(T('doc.footNote'))+'</div>'+
      '</div></body></html>';
  }

  function openOrderModal(row, body, onDone){
    if(!row && products.length === 0){ alert(T('rev.noProducts')); return; }
    ordEditingId = row ? row.id : null;
    const oStatuses = config.orderStatuses || [];
    const iStatuses = config.invoiceStatuses || [];
    const rTags = config.revenueTags || [];
    const today = new Date().toISOString().slice(0,10);
    let items = row ? row.items.map(it=> ({ ...it, costAllocation: (it.costAllocation||[]).map(a=>({...a})) })) : [{ productName:'', qty:1, price:0, colorId:null, colorName:'', costAllocation:[] }];
    let shipInclude = (row && Array.isArray(row.shipInclude)) ? new Set(row.shipInclude) : null;
    let shipOverride = (row && row.shippingOverride!=null) ? row.shippingOverride : null;
    let shipDiscByCat = (row && row.shipDiscByCat) ? JSON.parse(JSON.stringify(row.shipDiscByCat)) : {};
    const discTypeOpts = (sel)=> ['baht','percent'].map(t=> `<option value="${t}" ${(sel||'baht')===t?'selected':''}>${t==='baht'?'฿':'%'}</option>`).join('');
    // Structured delivery address (parts + composed string). Legacy orders had a free-text string → put it in line1.
    let addr = { line1:'', pCode:null, dCode:null, sCode:null, postal:'' };
    let delMethod = (row && row.deliveryMethod) || (((config.shippingTypes||[])[0]||{}).name || '');
    let delResp = (row && row.deliveryResponsible) || '';
    let deliveryProof = (row && row.deliveryProof) || null;
    if(row && row.addressParts){ const ap = row.addressParts; addr = { line1: ap.line1||'', pCode: ap.provinceCode||null, dCode: ap.districtCode||null, sCode: ap.subdistrictCode||null, postal: ap.postalCode||'' }; }
    else if(row && row.address){ addr.line1 = row.address; }

    body.innerHTML = `
      <div class="panel art-order-form-page">
        <div class="art-order-form-head">
          <button type="button" class="btn btn-ghost" id="oBack">← ${esc(T('rev.back'))}</button>
          <h3 class="art-modal-title">${esc(row ? T('rev.editTitle') : T('rev.addTitle'))}</h3>
          <div class="art-modal-invoice"><span class="art-modal-invoice-label">${esc(T('rev.invoiceNo'))}</span><span id="ordInvPreview" class="art-modal-invoice-no">-</span></div>
        </div>
        <h4 class="art-form-section">${esc(T('sec.order'))}</h4>
        <div class="art-form-grid">
          <label>${esc(T('exp.date'))} <span class="art-req">*</span><input type="date" id="oDate" value="${row?esc(row.date):today}"></label>
          <label>${esc(T('rev.orderStatus'))}<select id="oOs" ${canChange('changeOrderStatus')?'':'disabled'}>${oStatuses.map(s=>`<option value="${esc(s.name)}" ${row&&row.orderStatus===s.name?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select></label>
          <label>${esc(T('rev.invoiceStatus'))}<select id="oIs" ${canChange('changeInvoiceStatus')?'':'disabled'}>${iStatuses.map(s=>`<option value="${esc(s.name)}" ${row&&row.invoiceStatus===s.name?'selected':''}>${esc(itemLabel(s))}</option>`).join('')}</select></label>
          <label>${esc(T('exp.tag'))}<select id="oTag" ${canChange('changeRevenueTag')?'':'disabled'}>${rTags.map(t=>`<option value="${esc(t.name)}" ${row&&row.tag===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select></label>
        </div>
        <h4 class="art-form-section">${esc(T('sec.customer'))}</h4>
        <div class="art-form-grid">
          <label>${esc(T('rev.platform'))}<input type="text" id="oPlatform" value="${row?esc(row.platform||''):''}" placeholder="${esc(T('rev.platformHint'))}"></label>
          <label class="art-form-full">${esc(T('rev.customer'))} <span class="art-req">*</span><input type="text" id="oCustomer" value="${row?esc(row.customerName||''):''}" placeholder="${esc(T('rev.customerHint'))}"></label>
          <label>${esc(T('rev.phone'))}<input type="tel" id="oPhone" value="${row?esc(row.phone||''):''}" placeholder="${esc(T('rev.phoneHint'))}"></label>
        </div>
        <h4 class="art-form-section">${esc(T('sec.delivery'))}</h4>
        <div class="art-cust-split">
        <div class="art-cust-left">
        <div class="art-form-grid">
          <label>${esc(T('rev.deliveryMethod'))}<select id="oDeliveryMethod">${(config.shippingTypes||[]).map(st=> `<option value="${esc(st.name)}" ${delMethod===st.name?'selected':''}>${esc(itemLabel(st))}</option>`).join('')}</select></label>
          <label>${esc(T('rev.responsible'))}<span id="oRespWrap" class="art-resp-wrap"></span></label>
        </div>
        <div id="oProofWrap"></div>
        <div class="art-form-grid art-cust-fields">
          <label class="art-form-full">${esc(T('rev.addrLine'))} <span class="art-req">*</span><textarea id="oAddrLine" rows="2" placeholder="${esc(T('rev.addrLineHint'))}"></textarea></label>
          <label>${esc(T('rev.province'))} <span class="art-req">*</span><select id="oProvince"><option value="">${esc(T('rev.loading'))}</option></select></label>
          <label>${esc(T('rev.district'))} <span class="art-req">*</span><select id="oDistrict" disabled><option value="">—</option></select></label>
          <label>${esc(T('rev.subdistrict'))} <span class="art-req">*</span><select id="oSubdistrict" disabled><option value="">—</option></select></label>
          <label>${esc(T('rev.postal'))}<input type="text" id="oPostal" inputmode="numeric" placeholder="${esc(T('rev.postalHint'))}"></label>
        </div>
        <h4 class="art-form-section art-inv-head">${esc(T('sec.inventory'))}</h4>
        <div class="art-item-cols"><span>${esc(T('rev.itemProduct'))}</span><span>${esc(T('rev.itemQty'))}</span><span>${esc(T('rev.itemPrice'))}</span><span>${esc(T('rev.itemDisc'))}</span><span></span><span>${esc(T('rev.itemNet'))}</span><span></span></div>
        <div id="oItems" class="art-items"></div>
        <button type="button" class="btn btn-ghost art-add-item" id="oAddItem">${esc(T('rev.addItem'))}</button>
        <h4 class="art-form-section art-ship-head">${esc(T('rev.shippingTitle'))}</h4>
        <div id="oShipList" class="art-ship-list"></div>
        <div class="art-ship-override"><label>${esc(T('rev.shippingOverride'))}<input type="number" id="oShipOverride" value="${row&&row.shippingOverride!=null?row.shippingOverride:''}" placeholder="${esc(T('rev.shipAuto'))}" min="0"></label></div>
        </div>
        <div class="art-cust-map"><div class="th-map-hint">${esc(T('rev.mapHint'))}</div><div id="oMap" class="th-map-box">${esc(T('rev.loading'))}</div><div class="th-map-selected" id="oMapSel"></div><div class="th-map-legend" id="oMapLegend"></div></div>
        </div>
        <h4 class="art-form-section">${esc(T('rev.discountsTitle'))}</h4>
        <div class="art-form-grid" style="margin-top:6px;">
          <label>${esc(T('rev.overallDiscount'))}<span class="art-disc-inp"><input type="number" id="oOverallDisc" value="${row&&row.overallDiscount?row.overallDiscount:0}" step="0.01" min="0"><select id="oOverallDiscType">${discTypeOpts(row?row.overallDiscountType:'baht')}</select></span></label>
        </div>
        <label class="art-form-note">${esc(T('exp.note'))}<textarea id="oNote" rows="2">${row?esc(row.note||''):''}</textarea></label>
        <div class="art-modal-preview">
          <span>${esc(T('rev.itemsTotal'))}: <b id="oPvItems">0</b></span>
          <span>${esc(T('rev.shippingCost'))}: <b id="oPvShip">0</b></span>
          <span>${esc(T('rev.totalDiscount'))}: <b id="oPvDisc">0</b></span>
          <span>${esc(T('exp.net'))}: <b id="oPvNet">0</b></span>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="oCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="oSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    const g = (id)=> body.querySelector('#'+id);

    // ---- cost-lot allocation helpers (per order item) ----
    const colorsOf = (pid)=>{ const p = products.find(x=> x.id === pid); return (p && p.hasColors && Array.isArray(p.colors)) ? p.colors : []; };
    // A coloured product's lots are scoped to the item's chosen colour.
    const lotsForItem = (it)=>{ const cols = colorsOf(it.productId); return lots.filter(l=> l.productId===it.productId && (cols.length ? (l.colorId||null) === (it.colorId||null) : true)); };
    const originsOf = (it)=> [...new Set(lotsForItem(it).map(l=> l.origin))];
    const usedByOtherOrders = (lotId)=>{ let u=0; orders.forEach(o=>{ if(o.id===ordEditingId) return; (o.items||[]).forEach(it=> (it.costAllocation||[]).forEach(a=>{ if(a.lotId===lotId) u+=(a.qty||0); })); }); return u; };
    const formUsedExcept = (lotId, xi, xai)=>{ let u=0; items.forEach((it,ii)=> (it.costAllocation||[]).forEach((a,ai)=>{ if(ii===xi && ai===xai) return; if(a.lotId===lotId) u+=(a.qty||0); })); return u; };
    const lotAvail = (lot, xi, xai)=> (lot.qtyIn||0) - usedByOtherOrders(lot.id) - formUsedExcept(lot.id, xi, xai);
    const allocSum = (it)=> (it.costAllocation||[]).reduce((sm,a)=> sm+(a.qty||0), 0);
    const lotOptionsFor = (it, origin, xi, xai, selId)=> lotsForItem(it).filter(l=> l.origin===origin).map(l=>{
      const av = lotAvail(l, xi, xai);
      if(av <= 0 && l.id !== selId) return '';
      return `<option value="${l.id}" ${l.id===selId?'selected':''}>฿${fmt(l.cost)} · ${esc(T('alloc.left'))} ${av}</option>`;
    }).filter(Boolean).join('');
    function allocHtml(it, i){
      if(!it.productId) return '';
      if(colorsOf(it.productId).length && !it.colorId){
        return `<div class="art-alloc" data-i="${i}"><div class="art-alloc-hint">${esc(T('rev.pickColorFirst'))}</div></div>`;
      }
      const sum = allocSum(it), ok = sum === (it.qty||0);
      const rows = (it.costAllocation||[]).map((a,ai)=> `
        <div class="art-alloc-row" data-i="${i}" data-ai="${ai}">
          <select class="art-alloc-f" data-f="origin">
            <option value="">${esc(T('alloc.pickOrigin'))}</option>
            ${originsOf(it).map(o=> `<option value="${esc(o)}" ${a.origin===o?'selected':''}>${esc(o)}</option>`).join('')}
          </select>
          <select class="art-alloc-f" data-f="lotId" ${!a.origin?'disabled':''}>
            <option value="">${esc(T('alloc.pickLot'))}</option>
            ${lotOptionsFor(it, a.origin, i, ai, a.lotId)}
          </select>
          <input type="number" class="art-alloc-f art-alloc-qty" data-f="qty" value="${a.qty||''}" min="1" step="1" placeholder="${esc(T('alloc.qty'))}">
          <button type="button" class="acc-icon art-alloc-del">✕</button>
        </div>`).join('');
      return `<div class="art-alloc" data-i="${i}">
        <div class="art-alloc-head"><span>${esc(T('alloc.title'))}</span><span class="art-alloc-sum ${ok?'':'art-alloc-bad'}">${sum}/${it.qty||0}</span></div>
        ${rows}
        <button type="button" class="btn btn-ghost art-alloc-add">${esc(T('alloc.add'))}</button>
      </div>`;
    }
    function colorHtml(it, i){
      const cols = colorsOf(it.productId);
      if(!cols.length) return '';
      const prod = products.find(x=> x.id === it.productId);
      const sel = cols.find(c=> c.id === it.colorId);
      return `<div class="art-item-colorbar" data-i="${i}">
        <span class="pc-dot" style="background:${esc(sel ? (sel.hex||'#888') : 'transparent')}"></span>
        <span class="art-item-colorlabel">${esc(T('pc.colorLabel'))}</span>
        <select class="art-item-color" data-f="colorId">
          <option value="">${esc(T('pc.pickColor'))}</option>
          ${cols.map(c=> `<option value="${esc(c.id)}" ${it.colorId===c.id?'selected':''}>${esc(c.name||'-')} \u00B7 ${esc(T('alloc.left'))} ${stockOfColor(prod, c.id).remaining}${c.price!=null?' \u00B7 \u0E3F'+fmt(c.price):''}</option>`).join('')}
        </select>
      </div>`;
    }
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
          <input type="number" class="art-item-disc" data-f="discount" value="${it.discount||0}" step="0.01" min="0">
          <select class="art-item-disctype" data-f="discountType">${discTypeOpts(it.discountType)}</select>
          <span class="art-item-net" data-net="${i}">${fmt(itemNet(it))}${it.salePercent?` <i class="art-item-sale">-${it.salePercent}%</i>`:''}</span>
          <button type="button" class="acc-icon art-item-del" ${items.length<=1?'disabled':''}>✕</button>
        </div>${colorHtml(it,i)}${allocHtml(it,i)}`).join('');
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
            items[i].colorId = null; items[i].colorName = '';
          }
          else { items[i].productId = null; items[i].productName = ''; items[i].salePercent = 0; items[i].colorId = null; items[i].colorName = ''; }
          items[i].costAllocation = [];   // product changed → clear cost-lot allocation
          drawItems(); updatePreview();
        });
        r.querySelectorAll('[data-f="discount"]').forEach(inp=> inp.addEventListener('input', ()=>{ items[i].discount = parseFloat(inp.value)||0; updatePreview(); }));
        r.querySelectorAll('[data-f="discountType"]').forEach(sel=> sel.addEventListener('change', ()=>{ items[i].discountType = sel.value; updatePreview(); }));
        // qty / price: update state + preview (price stays editable for special deals).
        r.querySelectorAll('[data-f="qty"], [data-f="price"]').forEach(inp=> inp.addEventListener('input', ()=>{
          items[i][inp.dataset.f] = parseFloat(inp.value)||0;
          if(inp.dataset.f==='qty'){ const b = g('oItems').querySelector(`.art-alloc[data-i="${i}"] .art-alloc-sum`); if(b){ const sm=allocSum(items[i]); b.textContent=sm+'/'+(items[i].qty||0); b.classList.toggle('art-alloc-bad', sm!==(items[i].qty||0)); } }
          updatePreview();
        }));
        r.querySelector('.art-item-del').addEventListener('click', ()=>{ if(items.length>1){ items.splice(i,1); drawItems(); updatePreview(); } });
      });
      g('oItems').querySelectorAll('.art-item-colorbar').forEach(bar=>{
        const i = parseInt(bar.dataset.i,10);
        bar.querySelector('.art-item-color').addEventListener('change', (e)=>{
          const cid = e.target.value || null;
          const c = colorsOf(items[i].productId).find(x=> x.id === cid);
          items[i].colorId = cid;
          items[i].colorName = c ? (c.name||'') : '';
          if(c && c.price != null){
            const pct = items[i].salePercent || 0;
            items[i].price = pct > 0 ? Math.round(c.price * (1 - pct/100) * 100) / 100 : Number(c.price);
          }
          items[i].costAllocation = [];   // colour changed → its lots differ
          drawItems(); updatePreview();
        });
      });
      g('oItems').querySelectorAll('.art-alloc').forEach(al=>{
        const i = parseInt(al.dataset.i,10);
        al.querySelectorAll('.art-alloc-row').forEach(rr=>{
          const ai = parseInt(rr.dataset.ai,10);
          rr.querySelector('[data-f="origin"]').addEventListener('change', (e)=>{
            const a = items[i].costAllocation[ai]; a.origin = e.target.value; a.lotId = ''; a.cost = 0;
            drawItems();
          });
          const lotSel = rr.querySelector('[data-f="lotId"]');
          if(lotSel) lotSel.addEventListener('change', (e)=>{
            const lot = lots.find(l=> l.id===e.target.value); const a = items[i].costAllocation[ai];
            a.lotId = e.target.value; a.cost = lot ? lot.cost : 0; if(lot) a.origin = lot.origin;
            drawItems();
          });
          const q = rr.querySelector('[data-f="qty"]');
          if(q) q.addEventListener('input', ()=>{
            items[i].costAllocation[ai].qty = parseInt(q.value)||0;
            const b = al.querySelector('.art-alloc-sum'); const sm = allocSum(items[i]);
            if(b){ b.textContent = sm+'/'+(items[i].qty||0); b.classList.toggle('art-alloc-bad', sm!==(items[i].qty||0)); }
          });
          rr.querySelector('.art-alloc-del').addEventListener('click', ()=>{ items[i].costAllocation.splice(ai,1); drawItems(); });
        });
        al.querySelector('.art-alloc-add').addEventListener('click', ()=>{
          if(!items[i].costAllocation) items[i].costAllocation = [];
          items[i].costAllocation.push({ origin:'', lotId:'', cost:0, qty:0 });
          drawItems();
        });
      });
      if(g('oShipList')){ fillShipList(); updatePreview(); }
    }
    const catOfItem = (it)=>{ const pr=products.find(x=> x.id===it.productId); return pr ? (pr.productType||'') : ''; };
    const discAmt = (base, val, type)=> (type==='percent' ? base*(Math.abs(val)||0)/100 : Math.abs(val)||0);
    const itemGross = (it)=> (it.qty||0)*(it.price||0);
    const itemNet = (it)=> itemGross(it) - discAmt(itemGross(it), it.discount||0, it.discountType||'baht');
    function shipRows(){ const cats=[...new Set(items.map(catOfItem).filter(Boolean))]; return cats.map(c=> ({ cat:c, cost: shipCostFor(c, addr.pCode) })); }
    function shipNetOf(r){ const d=shipDiscByCat[r.cat]||{}; return r.cost - discAmt(r.cost, d.v||0, d.type||'baht'); }
    function computeShipping(){
      if(shipOverride!=null && shipOverride!=='') return Math.abs(parseFloat(shipOverride))||0;
      const rows=shipRows();
      if(shipInclude===null) shipInclude=new Set(rows.map(r=> r.cat));
      return rows.filter(r=> shipInclude.has(r.cat)).reduce((s,r)=> s+shipNetOf(r), 0);
    }
    function fillShipList(){
      const box=g('oShipList'); if(!box) return;
      const rows=shipRows();
      if(shipInclude===null) shipInclude=new Set(rows.map(r=> r.cat));
      if(!rows.length){ box.innerHTML = `<p class="art-ship-empty">${esc(T('rev.shipNoCat'))}</p>`; return; }
      const header = `<div class="art-ship-cols"><span></span><span></span><span></span><span>${esc(T('rev.itemDisc'))}</span><span></span><span>${esc(T('rev.itemNet'))}</span></div>`;
      box.innerHTML = header + rows.map(r=>{ const d=shipDiscByCat[r.cat]||{}; return `<div class="art-ship-row"><input type="checkbox" class="art-ship-cb" data-cat="${esc(r.cat)}" ${shipInclude.has(r.cat)?'checked':''}><span class="art-ship-cat">${esc(dispName('productTypes', r.cat))}</span><span class="art-ship-cost">${fmt(r.cost)}</span><input type="number" class="art-ship-disc" data-cat="${esc(r.cat)}" value="${d.v||0}" step="0.01" min="0"><select class="art-ship-disctype" data-cat="${esc(r.cat)}">${discTypeOpts(d.type)}</select><span class="art-ship-net" data-shipnet="${esc(r.cat)}">${fmt(shipNetOf(r))}</span></div>`; }).join('');
      box.querySelectorAll('.art-ship-cb').forEach(cb=> cb.addEventListener('change', ()=>{ if(cb.checked) shipInclude.add(cb.dataset.cat); else shipInclude.delete(cb.dataset.cat); updatePreview(); }));
      box.querySelectorAll('.art-ship-disc').forEach(inp=> inp.addEventListener('input', ()=>{ const c=inp.dataset.cat; shipDiscByCat[c]=shipDiscByCat[c]||{}; shipDiscByCat[c].v=parseFloat(inp.value)||0; updatePreview(); }));
      box.querySelectorAll('.art-ship-disctype').forEach(sel=> sel.addEventListener('change', ()=>{ const c=sel.dataset.cat; shipDiscByCat[c]=shipDiscByCat[c]||{}; shipDiscByCat[c].type=sel.value; updatePreview(); }));
    }
    function updatePreview(){
      const itemsGross = items.reduce((s,it)=> s+itemGross(it), 0);
      const itemsNet = items.reduce((s,it)=> s+itemNet(it), 0);
      const shipping = computeShipping();
      const srows = shipRows();
      const shipGross = (shipOverride!=null && shipOverride!=='') ? shipping : srows.filter(r=> shipInclude && shipInclude.has(r.cat)).reduce((a,r)=> a+(r.cost||0), 0);
      const sub = itemsNet + shipping;
      const overallAmt = discAmt(sub, parseFloat(g('oOverallDisc').value)||0, g('oOverallDiscType')?g('oOverallDiscType').value:'baht');
      const net = sub - overallAmt;
      const totalDisc = (itemsGross - itemsNet) + (shipGross - shipping) + overallAmt;
      g('oPvItems').textContent = fmt(itemsNet);
      if(g('oPvShip')) g('oPvShip').textContent = fmt(shipping);
      if(g('oPvDisc')) g('oPvDisc').textContent = fmt(totalDisc);
      g('oPvNet').textContent = fmt(net);
      const box=g('oItems'); if(box) items.forEach((it,i)=>{ const el=box.querySelector('.art-item-net[data-net="'+i+'"]'); if(el) el.innerHTML = fmt(itemNet(it)) + (it.salePercent?` <i class="art-item-sale">-${it.salePercent}%</i>`:''); });
      const sbox=g('oShipList'); if(sbox){ const srows=shipRows(); sbox.querySelectorAll('.art-ship-net').forEach(el=>{ const r=srows.find(x=> x.cat===el.dataset.shipnet); if(r) el.textContent=fmt(shipNetOf(r)); }); }
    }
    function updateInv(){
      const date = g('oDate').value;
      if(!date){ g('ordInvPreview').textContent='-'; return; }
      if(ordEditingId && row && date === row.date){ g('ordInvPreview').textContent = row.invoiceNumber || '-'; }
      else g('ordInvPreview').textContent = generateInvoiceNumber(date, ordEditingId);
    }
    drawItems(); fillShipList(); updatePreview(); updateInv();
    g('oAddItem').addEventListener('click', ()=>{ items.push({ productName:'', qty:1, price:0, colorId:null, colorName:'', costAllocation:[] }); drawItems(); fillShipList(); updatePreview(); });
    g('oOverallDisc').addEventListener('input', updatePreview);
    g('oOverallDiscType').addEventListener('change', updatePreview);
    g('oShipOverride').addEventListener('input', ()=>{ const v=g('oShipOverride').value; shipOverride=(v===''?null:v); updatePreview(); });
    g('oDate').addEventListener('change', updateInv);

    // ---- structured address cascade (lazy TH geography) ----
    const geoP = ()=> (window.__thGeo ? window.__thGeo.p : []);
    const geoD = (pc)=> (window.__thGeo ? window.__thGeo.d.filter(d=> d[1]===pc) : []);
    const geoS = (dc)=> (window.__thGeo ? window.__thGeo.s.filter(x=> x[1]===dc) : []);
    const geoLang = ()=> (((window.appLang && window.appLang()) || 'th') === 'en' ? 'en' : 'th');
    const provName = (c)=>{ const p=geoP().find(x=> x[0]===c); return p ? (geoLang()==='en'?p[2]:p[1]) : ''; };
    function renderLegend(){ const lg=g('oMapLegend'); if(!lg) return; lg.innerHTML = regionKeys().map(k=> `<span class="th-legend-item"><i class="th-swatch th-sw-${k}"></i>${esc(T('region.'+k))}</span>`).join(''); }
    function updateSelectedLabel(){ const el=g('oMapSel'); if(!el) return; el.textContent = addr.pCode ? (T('rev.selProvince')+': '+provName(addr.pCode)) : T('rev.noProvince'); }
    function fillProvince(){ const sel=g('oProvince'); if(!sel) return; sel.innerHTML = `<option value="">— ${esc(T('rev.province'))} —</option>` + geoP().map(p=> `<option value="${p[0]}" ${addr.pCode===p[0]?'selected':''}>${esc(geoLang()==='en'?p[2]:p[1])}</option>`).join(''); }
    function fillDistrict(){ const sel=g('oDistrict'); if(!sel) return; sel.innerHTML = `<option value="">— ${esc(T('rev.district'))} —</option>` + geoD(addr.pCode).map(d=> `<option value="${d[0]}" ${addr.dCode===d[0]?'selected':''}>${esc(geoLang()==='en'?d[3]:d[2])}</option>`).join(''); sel.disabled = !addr.pCode; }
    function fillSubdistrict(){ const sel=g('oSubdistrict'); if(!sel) return; sel.innerHTML = `<option value="">— ${esc(T('rev.subdistrict'))} —</option>` + geoS(addr.dCode).map(x=> `<option value="${x[0]}" ${addr.sCode===x[0]?'selected':''}>${esc(geoLang()==='en'?x[3]:x[2])}</option>`).join(''); sel.disabled = !addr.dCode; }
    function initAddress(){ const ln=g('oAddrLine'); if(ln) ln.value=addr.line1||''; const pin=g('oPostal'); if(pin) pin.value=addr.postal||''; fillProvince(); fillDistrict(); fillSubdistrict(); }
    function highlightMap(){ const box=g('oMap'); if(!box) return; box.querySelectorAll('.th-prov-g').forEach(el=> el.classList.toggle('selected', parseInt(el.dataset.code,10)===addr.pCode)); updateSelectedLabel(); }
    function setProvince(pc){ addr.pCode = pc||null; addr.dCode=null; addr.sCode=null; addr.postal=''; const ps=g('oProvince'); if(ps) ps.value = pc||''; const pin=g('oPostal'); if(pin) pin.value=''; fillDistrict(); fillSubdistrict(); highlightMap(); }
    function renderMap(){
      const box=g('oMap'); if(!box) return;
      if(!window.__thMap){ box.textContent=''; return; }
      const m=window.__thMap;
      const provs = m.paths.map(pp=> `<g class="th-prov-g" data-code="${pp.c}"><path class="th-prov th-r-${regionOfProvince(pp.c)}" d="${pp.d}"><title>${esc(provName(pp.c))}</title></path><text class="th-prov-lbl" x="${pp.x}" y="${pp.y}">${esc(provName(pp.c))}</text></g>`).join('');
      const lines = (regionMode()==='4'?m.regions4:m.regions6).map(r=> `<path class="th-region-line" d="${r.d}"/>`).join('');
      box.innerHTML = `<svg viewBox="${m.viewBox}" class="th-map" xmlns="http://www.w3.org/2000/svg">${provs}${lines}</svg>`;
      box.querySelectorAll('.th-prov-g').forEach(el=> el.addEventListener('click', ()=> setProvince(parseInt(el.dataset.code,10))));
      renderLegend(); highlightMap();
    }
    g('oAddrLine').addEventListener('input', e=>{ addr.line1 = e.target.value; });
    g('oPostal').addEventListener('input', e=>{ addr.postal = e.target.value; });
    g('oProvince').addEventListener('change', e=>{ setProvince(e.target.value?parseInt(e.target.value,10):null); });
    g('oDistrict').addEventListener('change', e=>{ addr.dCode = e.target.value?parseInt(e.target.value,10):null; addr.sCode=null; addr.postal=''; g('oPostal').value=''; fillSubdistrict(); });
    g('oSubdistrict').addEventListener('change', e=>{ addr.sCode = e.target.value?parseInt(e.target.value,10):null; const x = geoS(addr.dCode).find(y=> y[0]===addr.sCode); addr.postal = x?String(x[4]):''; g('oPostal').value = addr.postal; });
    ensureThGeo().then(()=> initAddress());
    Promise.all([ensureThGeo(), ensureThMap()]).then(()=> renderMap());

    // ---- delivery method + responsible (conditional) ----
    function respRole(){ const t=(config.shippingTypes||[]).find(s=> s.name===delMethod); return t ? (t.role||'') : ''; }
    function renderResponsible(){
      const wrap=g('oRespWrap'); if(!wrap) return;
      const role=respRole();
      if(role==='our'){
        const drivers = (typeof window.employeesByRoleType==='function' ? window.employeesByRoleType('driver') : []);
        wrap.innerHTML = `<select id="oResp"><option value="">${esc(T('rev.pickResp'))}</option>${drivers.map(d=> `<option value="${esc(d.name)}" ${delResp===d.name?'selected':''}>${esc(d.name)}</option>`).join('')}</select>`;
      } else if(role==='outsource'){
        wrap.innerHTML = `<select id="oResp"><option value="">${esc(T('rev.pickResp'))}</option>${(config.outsources||[]).map(o=> `<option value="${esc(o.name)}" ${delResp===o.name?'selected':''}>${esc(o.name)}</option>`).join('')}</select>`;
      } else {
        wrap.innerHTML = `<input type="text" id="oResp" value="${esc(delResp)}" placeholder="${esc(T('rev.respHint'))}">`;
      }
      const el=g('oResp');
      if(el){ el.addEventListener('change', ()=>{ delResp=el.value; }); el.addEventListener('input', ()=>{ delResp=el.value; }); }
      renderProof();
    }
    function renderProof(){
      const box=g('oProofWrap'); if(!box) return;
      if(respRole()!=='outsource'){ box.innerHTML=''; return; }
      box.innerHTML = `<div class="art-proof-field"><label class="art-proof-lbl">${esc(T('rev.proofLabel'))}</label>
        <div class="art-proof-row">
          <label class="file-picker"><input type="file" id="oProofFile" accept="image/*,.pdf"><span class="file-picker-btn">${esc(T('rev.proofPick'))}</span></label>
          <span class="art-proof-name">${deliveryProof ? esc(T('rev.proofAttached')) : esc(T('rev.proofNone'))}</span>
          ${deliveryProof ? `<button type="button" class="acc-icon" id="oProofClear" title="${esc(T('delete'))}">\u2715</button>` : ''}
        </div></div>`;
      const fi=g('oProofFile');
      if(fi) fi.addEventListener('change', (e)=>{ const f=e.target.files[0]; if(!f) return; if(f.size>256*1024){ alert(T('bill.tooBig')); e.target.value=''; return; } const r=new FileReader(); r.onload=()=>{ deliveryProof=r.result; renderProof(); }; r.readAsDataURL(f); });
      const clr=g('oProofClear'); if(clr) clr.addEventListener('click', ()=>{ deliveryProof=null; renderProof(); });
    }
    const _dm=g('oDeliveryMethod');
    if(_dm) _dm.addEventListener('change', ()=>{ delMethod=_dm.value; delResp=''; renderResponsible(); });
    renderResponsible();

    const close = ()=> (typeof onDone === 'function' ? onDone() : renderRevenuePage(body));
    const backBtn = g('oBack'); if(backBtn) backBtn.addEventListener('click', close);
    g('oCancel').addEventListener('click', close);
    g('oSave').addEventListener('click', async ()=>{
      const date = g('oDate').value;
      const customerName = g('oCustomer').value.trim();
      if(!date){ alert(T('exp.errDate')); return; }
      if(!customerName){ alert(T('rev.errCustomer')); return; }
      addr.line1 = g('oAddrLine').value.trim(); addr.postal = g('oPostal').value.trim();
      const _prov = geoP().find(p=> p[0]===addr.pCode), _dist = geoD(addr.pCode).find(d=> d[0]===addr.dCode), _subd = geoS(addr.dCode).find(x=> x[0]===addr.sCode);
      if(!addr.line1){ alert(T('rev.errAddrLine')); return; }
      if(!_prov || !_dist || !_subd){ alert(T('rev.errAddrGeo')); return; }
      const _addr = {
        str: `${addr.line1} ต.${_subd[2]} อ.${_dist[2]} จ.${_prov[1]} ${addr.postal}`.trim(),
        parts: { line1:addr.line1, provinceCode:addr.pCode, provinceName:_prov[1], districtCode:addr.dCode, districtName:_dist[2], subdistrictCode:addr.sCode, subdistrictName:_subd[2], postalCode:addr.postal }
      };
      const cleanItems = items.filter(it=> it.productId || it.productName.trim());
      if(cleanItems.length === 0){ alert(T('rev.errItems')); return; }
      if(cleanItems.some(it=> !it.productId)){ alert(T('rev.errPickProduct')); return; }
      const _noColor = cleanItems.find(it=> colorsOf(it.productId).length && !it.colorId);
      if(_noColor){ alert(T('rev.errPickColor').replace('{p}', _noColor.productName||'')); return; }
      // cost-lot allocation: each item must be fully allocated; no lot over-drawn.
      const perLot = {};
      for(const it of cleanItems){
        it.costAllocation = (it.costAllocation||[]).filter(a=> a.lotId && a.qty>0);
        const sm = it.costAllocation.reduce((x,a)=> x+(a.qty||0), 0);
        if(sm !== (it.qty||0)){ alert(T('alloc.errSum').replace('{p}', it.productName).replace('{a}', sm).replace('{q}', it.qty||0)); return; }
        it.costAllocation.forEach(a=> perLot[a.lotId] = (perLot[a.lotId]||0) + a.qty);
      }
      for(const lotId in perLot){
        const lot = lots.find(l=> l.id===lotId);
        const avail = (lot? (lot.qtyIn||0):0) - usedByOtherOrders(lotId);
        if(perLot[lotId] > avail){ alert(T('alloc.errOver').replace('{o}', lot?lot.origin:'').replace('{c}', lot?fmt(lot.cost):'')); return; }
      }
      const data = {
        id: ordEditingId || rid(), date, customerName, phone: (g('oPhone').value||'').trim(), address: _addr.str, addressParts: _addr.parts, deliveryMethod: delMethod, deliveryResponsible: delResp,
        platform: g('oPlatform').value.trim(),
        deliveryProof: deliveryProof,
        items: cleanItems,
        shipInclude: [...(shipInclude||[])],
        shippingOverride: (g('oShipOverride').value===''?null:Math.abs(parseFloat(g('oShipOverride').value)||0)),
        shippingCost: computeShipping(),
        shipDiscByCat: shipDiscByCat,
        overallDiscount: Math.abs(parseFloat(g('oOverallDisc').value)||0),
        overallDiscountType: g('oOverallDiscType').value,
        note: g('oNote').value.trim(),
        tag: g('oTag').value, orderStatus: g('oOs').value, invoiceStatus: g('oIs').value
      };
      if(ordEditingId && row && date === row.date){ data.invoiceNumber = row.invoiceNumber || generateInvoiceNumber(date, ordEditingId); }
      else data.invoiceNumber = generateInvoiceNumber(date, ordEditingId);
      const _now = new Date().toISOString();
      if(ordEditingId){ data.createdBy = (row && row.createdBy) || currentActorName(); data.createdAt = (row && row.createdAt) || _now; data.editedBy = currentActorName(); data.editedAt = _now; }
      else { data.createdBy = currentActorName(); data.createdAt = _now; }
      if(ordEditingId){ orders = orders.map(o=> o.id===ordEditingId ? data : o); logRec(orderLog, saveOrderLog, data.id, data.invoiceNumber, 'edit', data); }
      else { orders.push(data); logRec(orderLog, saveOrderLog, data.id, data.invoiceNumber, 'create', data); }
      await saveOrders();
      close();
    });
  }

  /* ================= Products page (PIN-gated) ================= */
  // Public stock snapshot for shop.html: remaining per product + per colour.
  // Quantities ONLY — cost lots and orders never leave the back office.
  async function syncPublicStock(){
    const snap = {};
    products.forEach(p=>{
      const entry = { total: stockOf(p).remaining, colors: {} };
      if(p.hasColors && Array.isArray(p.colors)) p.colors.forEach(c=>{ entry.colors[c.id] = stockOfColor(p, c.id).remaining; });
      snap[p.id] = entry;
    });
    await window.Store.set(K_STOCKPUB, snap);
  }
  // Buying stock IS an expense: every restock (and a new product's opening
  // stock) posts one row under the locked "Product" tag. Marked auto:true so
  // it's traceable back to the stock movement.
  function productTagName(){
    const t = (config.expenseTags||[]).find(x=> x.role === 'product');
    return t ? t.name : 'Product';
  }
  function postStockExpense(o){
    const qty = o.qty || 0, cost = o.cost || 0;
    if(qty <= 0 || cost <= 0) return null;
    const tag = productTagName();
    const rec = computeRow({
      id: rid(), date: o.date, details: o.details || '', tag,
      costPerPiece: cost, amount: qty, shippingFee: 0, discount: 0,
      purchaseFrom: o.origin || '', note: o.note || ''
    });
    rec.expenseId = generateExpenseId(o.date, tag, null);
    rec.auto = true;
    rec.autoSource = o.source || 'stock';
    rec.productId = o.productId || null;
    rec.colorId = o.colorId || null;
    expenses.push(rec);
    return rec;
  }
  async function saveProducts(){ await window.Store.set(K_PRODUCTS, products); await syncPublicStock(); }
  async function saveStockLog(){ await window.Store.set(K_STOCKLOG, stockLog); }
  async function saveLots(){ await window.Store.set(K_LOTS, lots); await syncPublicStock(); }
  function lotsOf(prod){ return lots.filter(l=> l.productId === prod.id); }
  // Colour is a subset of the product; a cost lot is a subset of the colour.
  function lotsOfColor(prod, colorId){ const cid = colorId || null; return lots.filter(l=> l.productId === prod.id && (l.colorId||null) === cid); }
  function stockOfColor(prod, colorId){
    const cid = colorId || null;
    const paidName = (statusByRole('invoiceStatuses','paid') || {}).name;
    let reserved = 0, sold = 0;
    orders.forEach(o=>{
      const qty = (o.items||[]).filter(it=> it.productId === prod.id && (it.colorId||null) === cid).reduce((sm,it)=> sm+(it.qty||0), 0);
      if(qty === 0) return;
      if(paidName && o.invoiceStatus === paidName) sold += qty; else reserved += qty;
    });
    const totalIn = lotsOfColor(prod, cid).reduce((sm,l)=> sm + (l.qtyIn||0), 0);
    return { reserved, sold, remaining: totalIn - reserved - sold };
  }
  function avgCostOfColor(prod, colorId){
    const ls = lotsOfColor(prod, colorId);
    const q = ls.reduce((sm,l)=> sm + (l.qtyIn||0), 0);
    if(!q) return 0;
    return ls.reduce((sm,l)=> sm + (Number(l.cost)||0) * (l.qtyIn||0), 0) / q;
  }
  function priceLabelOf(prod){
    const cols = (prod.hasColors && Array.isArray(prod.colors)) ? prod.colors.filter(c=> c.price != null && c.price !== '') : [];
    if(!cols.length) return fmt(prod.price);
    const ps = cols.map(c=> Number(c.price)||0);
    const mn = Math.min.apply(null, ps), mx = Math.max.apply(null, ps);
    return mn === mx ? fmt(mn) : fmt(mn) + ' - ' + fmt(mx);
  }
  // Per-lot reserved/sold from order costAllocation (all 0 until Lot 2 fills allocations,
  // then a sale that pulled from a lot shows up on that lot's detail row).
  function lotAlloc(lot){
    const paidName = (statusByRole('invoiceStatuses','paid') || {}).name;
    let reserved = 0, sold = 0;
    orders.forEach(o=>{
      let q = 0;
      (o.items||[]).forEach(it=> (it.costAllocation||[]).forEach(a=>{ if(a.lotId===lot.id) q += (a.qty||0); }));
      if(q === 0) return;
      if(paidName && o.invoiceStatus === paidName) sold += q; else reserved += q;
    });
    return { reserved, sold };
  }
  function lotRemaining(lot){ const a = lotAlloc(lot); return (lot.qtyIn||0) - a.reserved - a.sold; }
  // Weighted average unit cost across a product's lots — shown in the main row's Cost column.
  function avgCost(prod){
    const ls = lotsOf(prod);
    const totIn = ls.reduce((s,l)=> s + (l.qtyIn||0), 0);
    if(!totIn) return prod.cost || 0;
    return ls.reduce((s,l)=> s + (l.cost||0)*(l.qtyIn||0), 0) / totIn;
  }
  // Restock / opening stock: MERGE into an existing lot with the SAME origin+cost,
  // otherwise start a new lot row (new price from same origin, or a new origin).
  function addToLot(productId, origin, cost, qty, by, colorId){
    const cid = colorId || null;
    const existing = lots.find(l=> l.productId===productId && l.origin===origin && Number(l.cost)===Number(cost) && (l.colorId||null)===cid);
    if(existing){ existing.qtyIn = (existing.qtyIn||0) + qty; }
    else { lots.push({ id: rid(), productId, colorId: cid, origin, cost, qtyIn: qty, bill: null, date: new Date().toISOString().slice(0,10), by }); }
  }

  // One-time migration: legacy products (single stock/cost, no lots) → an opening
  // cost lot each. Guarded by config.lotsMigrated so it runs once.
  async function migrateStockLots(){
    if(!config || config.lotsMigrated) return;
    let changed = false;
    products.forEach(p=>{
      if((p.stock||0) > 0 && !lots.some(l=> l.productId === p.id)){
        lots.push({ id: rid(), productId: p.id, origin: 'ยกมา', cost: p.cost||0, qtyIn: p.stock, bill: null, date: new Date().toISOString().slice(0,10), by: '-' });
        changed = true;
      }
    });
    if(changed && config.costOrigins && !config.costOrigins.some(o=> o.name === 'ยกมา')){
      config.costOrigins.push({ id: rid(), name: 'ยกมา', color: '#8A8F80' });
    }
    config.lotsMigrated = true;
    if(changed) await saveLots();
    await saveConfig();
  }

  // "Who did this" — auto-stamped on stock actions from the logged-in employee.
  // Developer login (roleKey 'developer') is recorded literally as "Developer".
  function currentActorName(){
    const e = window.currentEmployee;
    if(!e) return '—';
    if(e.roleKey === 'developer') return 'Developer';
    const full = ((e.name || '') + ' ' + (e.surname || '')).trim();
    return full || e.username || 'Developer';
  }
  // Per-role permission to change a given status/tag type (system roles = allowed).
  function canChange(target){ return (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, target); }
  // Lazy-load the bundled TH geography data (province/district/subdistrict + postal) on first use.
  let _thGeoP = null;
  function ensureThGeo(){
    if(window.__thGeo) return Promise.resolve(window.__thGeo);
    if(_thGeoP) return _thGeoP;
    _thGeoP = new Promise((resolve)=>{
      const sc = document.createElement('script');
      sc.src = 'js/data/th-geo.js';
      sc.onload = ()=> resolve(window.__thGeo || null);
      sc.onerror = ()=> resolve(null);
      document.head.appendChild(sc);
    });
    return _thGeoP;
  }
  let _thMapP = null;
  function ensureThMap(){
    if(window.__thMap) return Promise.resolve(window.__thMap);
    if(_thMapP) return _thMapP;
    _thMapP = new Promise((resolve)=>{
      const sc = document.createElement('script'); sc.src = 'js/data/th-map.js';
      sc.onload = ()=> resolve(window.__thMap || null); sc.onerror = ()=> resolve(null);
      document.head.appendChild(sc);
    });
    return _thMapP;
  }
  function prodTagColor(name){ return (PRODUCT_TAGS.find(t=> t.name === name) || {}).color || '#999'; }
  function ptypeColor(name){ return ((config.productTypes||[]).find(t=> t.name === name) || {}).color || '#999'; }
  function originColor(name){ return ((config.costOrigins||[]).find(o=> o.name === name) || {}).color || '#8A8F80'; }
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
    const totalIn = lots.reduce((sum,l)=> l.productId === prod.id ? sum + (l.qtyIn||0) : sum, 0);
    return { reserved, sold, remaining: totalIn - reserved - sold };
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
              <th>${esc(T('prod.ptype'))}</th><th>${esc(T('prod.tag'))}</th><th>${esc(T('col.lastEdited'))}</th><th></th></tr></thead>
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

  // One aligned detail <tr> per lot — columns line up with the main product table.
  function lotRowHtml(l, cls, dataAttr, indent){
    const a = lotAlloc(l);
    const rem = (l.qtyIn||0) - a.reserved - a.sold;
    return `<tr class="${cls}" ${dataAttr} style="display:none;">
        <td></td><td></td>
        <td class="${indent?'prod-sub2':''}"><span class="art-pill" style="background:${originColor(l.origin)}">${esc(l.origin||'-')}</span></td>
        <td class="num">${fmt(l.cost)}</td>
        <td></td><td></td>
        <td class="num">${rem}</td>
        <td class="num art-reserved">${a.reserved || '-'}</td>
        <td class="num art-sold">${a.sold || '-'}</td>
        <td></td><td></td><td></td><td></td>
      </tr>`;
  }
  function lotDetailRows(prod){
    const cols = (prod.hasColors && Array.isArray(prod.colors)) ? prod.colors : [];
    if(cols.length){
      const buckets = cols.map(c=> ({ id: c.id, label: c.name || '-', hex: c.hex || '#888', price: c.price }));
      if(lots.some(l=> l.productId === prod.id && !l.colorId)) buckets.push({ id: null, label: T('pc.noColor'), hex: '#6b6b6b', price: prod.price });
      return buckets.map(b=>{
        const st = stockOfColor(prod, b.id);
        const key = prod.id + '|' + (b.id || '_none');
        const ls = lotsOfColor(prod, b.id);
        const head = `<tr class="prod-lots-detail prod-color-row" data-lots="${prod.id}" data-ckey="${esc(key)}" style="display:none;">
        <td></td><td></td>
        <td class="prod-sub1"><span class="prod-color-toggle" data-ct="${esc(key)}">\u25B8</span><span class="pc-dot" style="background:${esc(b.hex)}"></span>${esc(b.label)}</td>
        <td class="num">${fmt(avgCostOfColor(prod, b.id))}</td>
        <td class="num">${b.price != null && b.price !== '' ? fmt(b.price) : '-'}</td>
        <td></td>
        <td class="num" style="font-weight:700;">${st.remaining}</td>
        <td class="num art-reserved">${st.reserved || '-'}</td>
        <td class="num art-sold">${st.sold || '-'}</td>
        <td></td><td></td><td></td><td></td>
      </tr>`;
        const lotRows = ls.length
          ? ls.map(l=> lotRowHtml(l, 'prod-clot-detail', `data-clots="${esc(key)}"`, true)).join('')
          : `<tr class="prod-clot-detail" data-clots="${esc(key)}" style="display:none;"><td></td><td></td><td colspan="11" class="prod-sub2" style="color:var(--c-muted); font-size:12.5px;">${esc(T('prod.noLots'))}</td></tr>`;
        return head + lotRows;
      }).join('');
    }
    const ls = lotsOf(prod);
    if(!ls.length){
      return `<tr class="prod-lots-detail" data-lots="${prod.id}" style="display:none;"><td></td><td></td><td colspan="11" style="color:var(--c-muted); font-size:12.5px;">${esc(T('prod.noLots'))}</td></tr>`;
    }
    return ls.map(l=> lotRowHtml(l, 'prod-lots-detail', `data-lots="${prod.id}"`, false)).join('');
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
          <td><span class="prod-lot-toggle" data-lt="${p.id}">▸</span>${esc(p.name)}</td>
          <td class="num">${fmt(avgCost(p))}</td>
          <td class="num">${priceLabelOf(p)}</td>
          <td class="num">${salePct ? `<span class="art-pill" style="background:var(--c-danger)">-${salePct}%</span>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td class="num ${low?'art-neg':''}" style="font-weight:700;">${st.remaining}</td>
          <td class="num art-reserved">${st.reserved || '-'}</td>
          <td class="num art-sold">${st.sold || '-'}</td>
          <td>${p.productType ? `<span class="art-pill" style="background:${ptypeColor(p.productType)}">${esc(p.productType)}</span>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td><span class="art-pill" style="background:${prodTagColor(p.tag)}">${esc(p.tag||'In Stock')}</span></td>
          <td class="art-edited">${esc(editedLabel(p))}</td>
          <td><div class="art-row-actions">
            <button class="acc-icon art-prod-edit" title="${esc(T('edit'))}">✎</button>
            <button class="acc-icon art-prod-del" title="${esc(T('delete'))}">✕</button>
          </div></td>
        </tr>
        ${lotDetailRows(p)}`;
      }).join('');
      tbody.querySelectorAll('tr[data-id]').forEach(tr=>{
        const id = tr.dataset.id;
        tr.querySelector('.art-prod-edit').addEventListener('click', (e)=>{ e.stopPropagation(); openProductModal(products.find(p=>p.id===id), body); });
        tr.querySelector('.art-prod-del').addEventListener('click', async (e)=>{
          e.stopPropagation();
          if(!window.confirm(T('prod.delConfirm'))) return;
          const _pd = products.find(p=> p.id === id);
          if(_pd){
            logRec(productLog, saveProductLog, id, (_pd.name||'')+(_pd.sku?' ('+_pd.sku+')':''), 'delete', _pd);
            // Cost lots ride along with the product so Cost Summary only ever
            // reflects stock that really exists; restoring brings them back.
            const _bin = toBin(_pd);
            _bin._lots = lots.filter(l=> l.productId === id).map(l=> JSON.parse(JSON.stringify(l)));
            // The expenses this product's stock generated go with it, so the cost
            // donuts and the expense total keep telling the same story.
            _bin._expenses = expenses.filter(e=> e.auto && e.productId === id).map(e=> JSON.parse(JSON.stringify(e)));
            deletedProducts.push(_bin);
            lots = lots.filter(l=> l.productId !== id);
            expenses = expenses.filter(e=> !(e.auto && e.productId === id));
            await saveDeletedProducts(); await saveLots(); await saveExpenses();
          }
          products = products.filter(p=> p.id !== id);
          await saveProducts();
          renderProductsTable(body);
        });
        // Click anywhere on the row → toggle this product's lot detail rows.
        tr.addEventListener('click', ()=>{
          const rows = tbody.querySelectorAll(`.prod-lots-detail[data-lots="${id}"]`);
          if(!rows.length) return;
          const open = rows[0].style.display === 'none';
          rows.forEach(r=> r.style.display = open ? '' : 'none');
          if(!open){
            tbody.querySelectorAll(`.prod-clot-detail[data-clots^="${id}|"]`).forEach(r=> r.style.display = 'none');
            tbody.querySelectorAll(`.prod-color-toggle[data-ct^="${id}|"]`).forEach(c=> c.textContent = '\u25B8');
          }
          const car = tr.querySelector('.prod-lot-toggle');
          if(car) car.textContent = open ? '▾' : '▸';
        });
      });
      tbody.querySelectorAll('.prod-color-row').forEach(cr=> cr.addEventListener('click', (e)=>{
        e.stopPropagation();
        const key = cr.dataset.ckey;
        const rows = tbody.querySelectorAll(`.prod-clot-detail[data-clots="${key}"]`);
        if(!rows.length) return;
        const open = rows[0].style.display === 'none';
        rows.forEach(r=> r.style.display = open ? '' : 'none');
        const car = cr.querySelector('.prod-color-toggle');
        if(car) car.textContent = open ? '\u25BE' : '\u25B8';
      }));
    }
  }

  function openProductModal(row, body){
    prodEditingId = row ? row.id : null;
    prodImageData = row ? (row.image || null) : null;
    prodBillData = null;
    const isNewProd = !row;
    let pHasColors = !!(row && row.hasColors);
    let pColors = (row && Array.isArray(row.colors)) ? JSON.parse(JSON.stringify(row.colors)) : [];
    pColors.forEach(c=>{ if(!Array.isArray(c.images)) c.images = c.image ? [c.image] : []; if(!Array.isArray(c.imageNames)) c.imageNames = []; while(c.imageNames.length < c.images.length) c.imageNames.push(''); });
    let pImages = (row && Array.isArray(row.images) && row.images.length) ? row.images.slice(0,5) : (row && row.image ? [row.image] : []);
    let pImageNames = (row && Array.isArray(row.imageNames)) ? row.imageNames.slice(0,5) : [];
    while(pImageNames.length < pImages.length) pImageNames.push('');
    const ov = body;
    ov.innerHTML = `
      <div class="panel art-order-form-page">
        <div class="art-order-form-head">
          <button type="button" class="btn btn-ghost" id="pBack">\u2190 ${esc(T('rev.back'))}</button>
          <h3 class="art-modal-title">${esc(row ? T('prod.editTitle') : T('prod.addTitle'))}</h3>
        </div>
        <h4 class="art-form-section">${esc(T('sec.detail'))}</h4>
        <div class="art-form-grid">
          <label>${esc(T('prod.sku'))}<input type="text" id="pSku" value="${row?esc(row.sku):''}"></label>
          <label>${esc(T('prod.tag'))}<select id="pTag" ${canChange('changeProductStatus')?'':'disabled'}>${PRODUCT_TAGS.map(t=>`<option value="${esc(t.name)}" ${row&&row.tag===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select></label>
          <label class="art-form-full">${esc(T('prod.name'))}<input type="text" id="pName" value="${row?esc(row.name):''}"></label>
          <label class="art-form-full">${esc(T('prod.ptype'))} <span class="art-req">*</span><select id="pType"><option value="">${esc(T('prod.pickType'))}</option>${(config.productTypes||[]).map(t=>`<option value="${esc(t.name)}" ${row&&row.productType===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select></label>
          <label class="art-form-full">${esc(T('prod.desc'))}<textarea id="pDesc" rows="3" placeholder="${esc(T('prod.descPh'))}">${row?esc(row.description||''):''}</textarea></label>
        </div>
        <div class="art-img-field" id="pImgField" style="${pHasColors?'display:none;':''}">
          <label class="art-img-label">${esc(T('prod.image'))} <span class="pi-hint">${esc(T('img.max5'))}</span></label>
          <div class="pi-grid" id="pImgGrid"></div>
        </div>
        <h4 class="art-form-section">${esc(T('pc.section'))}</h4>
        <label class="pc-switch"><input type="checkbox" id="pHasColors" ${pHasColors?'checked':''}><span>${esc(T('pc.enable'))}</span></label>
        <div class="pc-list" id="pColorList" style="${pHasColors?'':'display:none;'}"></div>
        <h4 class="art-form-section">${esc(T('sec.cost'))}</h4>
        <div class="art-form-grid">
          <label>${esc(T('prod.origin'))}<select id="pOrigin">${(config.costOrigins||[]).map(o=>`<option value="${esc(o.name)}">${esc(o.name)}</option>`).join('')}</select></label>
          <label id="pCostField" style="${pHasColors?'display:none;':''}">${esc(T('prod.cost'))}<input type="number" id="pCost" value="${row?row.cost:0}" step="0.01"></label>
        </div>
        <div id="pSellFields" style="${pHasColors?'display:none;':''}">
        <h4 class="art-form-section">${esc(T('sec.selling'))}</h4>
        <div class="art-form-grid">
          <label>${esc(T('prod.stock'))}<input type="number" id="pStock" value="${row?row.stock:0}" step="1"></label>
          <label>${esc(T('prod.price'))}<input type="number" id="pPrice" value="${row?row.price:0}" step="0.01"></label>
        </div>
        </div>
        <h4 class="art-form-section">${esc(T('sec.evidence'))}</h4>
        <div class="art-img-field">
          <label class="art-img-label">${esc(T('prod.bill'))}</label>
          <label class="file-picker">
            <input type="file" id="pBillInput" accept="image/*,application/pdf">
            <span class="file-picker-btn">${esc(T('io.chooseFile'))}</span>
            <span class="file-picker-name" id="pBillName">${esc(T('io.noFile'))}</span>
          </label>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="pCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="pSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    const g = (id)=> ov.querySelector('#'+id);
    function addImageFiles(files, arr, names, done){
      Array.from(files || []).forEach(file=>{
        if(arr.length >= 5){ return; }
        if(file.size > 256*1024){ alert(T('bill.tooBig')); return; }
        const rd = new FileReader();
        rd.onload = ()=>{ if(arr.length < 5){ arr.push(rd.result); names.push(file.name || ''); done(); } };
        rd.readAsDataURL(file);
      });
    }
    function thumbsHtml(list, cls, attrs){
      return list.map((src,j)=> `<div class="pi-thumb ${cls}"><img src="${esc(src)}" alt=""><button type="button" class="pi-rm" ${attrs} data-j="${j}" title="${esc(T('pc.rmImage'))}">\u2715</button></div>`).join('');
    }
    function drawImages(){
      const wrap = g('pImgGrid'); if(!wrap) return;
      wrap.innerHTML = thumbsHtml(pImages, '', 'data-main="1"')
        + (pImages.length < 5 ? `<label class="pi-add"><input type="file" id="pImgInput" accept="image/*" multiple><span>+</span></label>` : '');
      wrap.querySelectorAll('.pi-rm').forEach(b=> b.addEventListener('click', ()=>{ const j = +b.dataset.j; pImages.splice(j, 1); pImageNames.splice(j, 1); drawImages(); }));
      const inp = wrap.querySelector('#pImgInput');
      if(inp) inp.addEventListener('change', (e)=> addImageFiles(e.target.files, pImages, pImageNames, drawImages));
    }
    function defaultColors(){
      const en = (window.appLang && window.appLang()) === 'en';
      return [
        { id: rid(), name: en?'Black':'\u0E14\u0E33', hex:'#000000', image:null, images:[], price:null, qty:'', cost:'' },
        { id: rid(), name: en?'Gray':'\u0E40\u0E17\u0E32',  hex:'#808080', image:null, images:[], price:null, qty:'', cost:'' },
        { id: rid(), name: en?'White':'\u0E02\u0E32\u0E27', hex:'#FFFFFF', image:null, images:[], price:null, qty:'', cost:'' }
      ];
    }
    function drawColors(){
      const wrap = g('pColorList'); if(!wrap) return;
      wrap.innerHTML = pColors.map((c,i)=>{
          if(!Array.isArray(c.images)) c.images = c.image ? [c.image] : [];
          if(!Array.isArray(c.imageNames)) c.imageNames = [];
          return `<div class="pc-row" data-i="${i}">
          <div class="pc-row-top">
            <input type="color" class="pc-hex" data-i="${i}" value="${esc(c.hex||'#000000')}">
            <input type="text" class="pc-name" data-i="${i}" value="${esc(c.name||'')}" placeholder="${esc(T('pc.namePh'))}">
            <input type="number" class="pc-num pc-price" data-i="${i}" value="${c.price!=null?c.price:''}" step="0.01" placeholder="${esc(T('prod.price'))}" title="${esc(T('prod.price'))}">
            ${isNewProd ? `<input type="number" class="pc-num pc-qty" data-i="${i}" value="${c.qty!=null?c.qty:''}" step="1" min="0" placeholder="${esc(T('prod.stock'))}" title="${esc(T('prod.stock'))}"><input type="number" class="pc-num pc-cost" data-i="${i}" value="${c.cost!=null?c.cost:''}" step="0.01" placeholder="${esc(T('prod.cost'))}" title="${esc(T('prod.cost'))}">` : ''}
            <button type="button" class="pc-del" data-i="${i}" title="${esc(T('delete'))}">\u2715</button>
          </div>
          <div class="pi-grid pc-imgs">${thumbsHtml(c.images, 'sm', `data-ci="${i}"`)}${c.images.length < 5 ? `<label class="pi-add sm" title="${esc(T('pc.image'))}"><input type="file" class="pc-img" data-i="${i}" accept="image/*" multiple><span>+</span></label>` : ''}</div>
        </div>`; }).join('') + `<button type="button" class="btn btn-ghost pc-add" id="pcAdd">${esc(T('pc.add'))}</button>`;
      wrap.querySelectorAll('.pc-hex').forEach(inp=> inp.addEventListener('input', ()=>{ pColors[+inp.dataset.i].hex = inp.value; }));
      wrap.querySelectorAll('.pc-name').forEach(inp=> inp.addEventListener('input', ()=>{ pColors[+inp.dataset.i].name = inp.value; }));
      wrap.querySelectorAll('.pc-price').forEach(inp=> inp.addEventListener('input', ()=>{ pColors[+inp.dataset.i].price = inp.value === '' ? null : (parseFloat(inp.value)||0); }));
      wrap.querySelectorAll('.pc-qty').forEach(inp=> inp.addEventListener('input', ()=>{ pColors[+inp.dataset.i].qty = inp.value === '' ? '' : (parseInt(inp.value)||0); }));
      wrap.querySelectorAll('.pc-cost').forEach(inp=> inp.addEventListener('input', ()=>{ pColors[+inp.dataset.i].cost = inp.value === '' ? '' : (parseFloat(inp.value)||0); }));
      wrap.querySelectorAll('.pc-img').forEach(inp=> inp.addEventListener('change', (e)=>{ const c = pColors[+inp.dataset.i]; if(!Array.isArray(c.imageNames)) c.imageNames = []; addImageFiles(e.target.files, c.images, c.imageNames, drawColors); }));
      wrap.querySelectorAll('.pc-imgs .pi-rm').forEach(btn=> btn.addEventListener('click', ()=>{ const c = pColors[+btn.dataset.ci], j = +btn.dataset.j; c.images.splice(j, 1); if(Array.isArray(c.imageNames)) c.imageNames.splice(j, 1); drawColors(); }));
      wrap.querySelectorAll('.pc-del').forEach(btn=> btn.addEventListener('click', ()=>{ pColors.splice(+btn.dataset.i, 1); drawColors(); }));
      const add = wrap.querySelector('#pcAdd');
      if(add) add.addEventListener('click', ()=>{ pColors.push({ id: rid(), name:'', hex:'#CCCCCC', image:null, images:[], imageNames:[], price:null, qty:'', cost:'' }); drawColors(); });
    }
    g('pHasColors').addEventListener('change', (e)=>{
      pHasColors = e.target.checked;
      if(pHasColors && pColors.length === 0) pColors = defaultColors();
      const wrap = g('pColorList'); if(wrap) wrap.style.display = pHasColors ? '' : 'none';
      const imgField = g('pImgField'); if(imgField) imgField.style.display = pHasColors ? 'none' : '';
      const costField = g('pCostField'); if(costField) costField.style.display = pHasColors ? 'none' : '';
      const sellFields = g('pSellFields'); if(sellFields) sellFields.style.display = pHasColors ? 'none' : '';
      drawColors();
    });
    drawColors();
    drawImages();
    const pbi = g('pBillInput');
    if(pbi) pbi.addEventListener('change', (e)=>{
      const file = e.target.files[0]; if(!file){ prodBillData=null; return; }
      if(file.size > 256*1024){ alert(T('bill.tooBig')); e.target.value=''; prodBillData=null; return; }
      const nm = ov.querySelector('#pBillName'); if(nm) nm.textContent = file.name;
      const reader2 = new FileReader();
      reader2.onload = ()=>{ prodBillData = reader2.result; };
      reader2.readAsDataURL(file);
    });
    const close = ()=> renderProductsPage(body);
    const backBtn = g('pBack'); if(backBtn) backBtn.addEventListener('click', close);
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
        description: (g('pDesc') ? g('pDesc').value.trim() : ''),
        cost: parseFloat(g('pCost').value)||0, price: parseFloat(g('pPrice').value)||0,
        stock: parseInt(g('pStock').value)||0, tag: g('pTag').value,
        image: pImages[0] || null, images: pImages.slice(0,5), imageNames: pImageNames.slice(0,5),
        hasColors: pHasColors,
        colors: pHasColors ? pColors.map(c=>{ const im = (Array.isArray(c.images)?c.images:[]).slice(0,5); return { id: c.id, name: c.name, hex: c.hex, price: (c.price === '' || c.price == null) ? null : Number(c.price), images: im, imageNames: (Array.isArray(c.imageNames)?c.imageNames:[]).slice(0,5), image: im[0] || null }; }) : []
      };
      if(pHasColors){
        const _ps = data.colors.map(c=> Number(c.price)||0).filter(v=> v > 0);
        data.price = _ps.length ? Math.min.apply(null, _ps) : 0;
        if(!prodEditingId) data.stock = pColors.reduce((sm,c)=> sm + (parseInt(c.qty)||0), 0);
      }
      const _pnow = new Date().toISOString();
      if(prodEditingId){
        const orig = products.find(p=> p.id === prodEditingId);
        data.createdBy = (orig && orig.createdBy) || currentActorName();   // keep the original creator
        data.createdAt = (orig && orig.createdAt) || _pnow;
        data.editedBy = currentActorName(); data.editedAt = _pnow;
        products = products.map(p=> p.id===prodEditingId ? data : p);
        logRec(productLog, saveProductLog, data.id, (data.name||'')+(data.sku?' ('+data.sku+')':''), 'edit', data, { imageChanges: imageChangeList(orig, data) });
      }else {
        data.createdBy = currentActorName(); data.createdAt = _pnow;
        products.push(data);
        logRec(productLog, saveProductLog, data.id, (data.name||'')+(data.sku?' ('+data.sku+')':''), 'create', data, { imageChanges: imageChangeList(null, data) });
        const _origin = g('pOrigin') ? g('pOrigin').value : '';
        const _iso = new Date().toISOString(), _day = _iso.slice(0,10);
        if(pHasColors && data.colors.length){
          // Opening stock is per colour: one cost lot (and one stock-log entry) each.
          let _any = false;
          data.colors.forEach((c, idx)=>{
            const q = parseInt(pColors[idx].qty) || 0;
            const cst = parseFloat(pColors[idx].cost) || 0;
            if(q <= 0) return;
            addToLot(data.id, _origin, cst, q, currentActorName(), c.id); _any = true;
            stockLog.push({ id: rid(), date: _day, productId: data.id, colorId: c.id, productName: data.name + ' \u00B7 ' + (c.name||''), productType: data.productType||'', qty: q, signature: currentActorName(), type: 'new', origin: _origin, cost: cst, bill: prodBillData, createdAt: _iso });
            postStockExpense({ date: _day, details: T('exp.newStockOf').replace('{p}', data.name + ' \u00B7 ' + (c.name||'')), qty: q, cost: cst, origin: _origin, productId: data.id, colorId: c.id, source:'newproduct' });
          });
          if(_any) await saveLots();
          else stockLog.push({ id: rid(), date: _day, productId: data.id, productName: data.name, productType: data.productType||'', qty: 0, signature: currentActorName(), type: 'new', origin: _origin, cost: 0, bill: prodBillData, createdAt: _iso });
        }else{
          if(data.stock > 0){
            addToLot(data.id, _origin, data.cost, data.stock, currentActorName());
            postStockExpense({ date: _day, details: T('exp.newStockOf').replace('{p}', data.name), qty: data.stock, cost: data.cost, origin: _origin, productId: data.id, source:'newproduct' });
            await saveLots();
          }
          // Every new product logs a "New Product" entry, auto-stamped with who added it.
          stockLog.push({ id: rid(), date: _day, productId: data.id, productName: data.name, productType: data.productType||'', qty: data.stock, signature: currentActorName(), type: 'new', origin: _origin, cost: data.cost, bill: prodBillData, createdAt: _iso });
        }
        await saveStockLog();
        await saveExpenses();
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
            <select id="kbTag"><option value="all">${esc(T('exp.all'))}</option>${rTags.map(t=>`<option value="${esc(t.name)}" ${kanbanFilter.tag===t.name?'selected':''}>${esc(itemLabel(t))}</option>`).join('')}</select>
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
      el.querySelector('.kcard-edit').addEventListener('click', (e)=>{ e.stopPropagation(); const o = orders.find(x=>x.id===el.dataset.id); openOrderModal(o, body, ()=> renderOrderKanban(body)); });
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
        <h4 class="art-form-section">${esc(T('sec.product'))}</h4>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('rst.ptype'))}
            <select id="rsType"><option value="all">${esc(T('rst.allTypes'))}</option>${(config.productTypes||[]).map(t=>`<option value="${esc(t.name)}">${esc(itemLabel(t))}</option>`).join('')}</select>
          </label>
          <label class="art-form-full">${esc(T('rst.product'))} <span class="art-req">*</span>
            <select id="rsProduct"></select>
          </label>
          <label id="rsColorField" style="display:none;">${esc(T('pc.colorLabel'))} <span class="art-req">*</span><select id="rsColor"></select></label>
          <label>${esc(T('rst.qty'))} <span class="art-req">*</span><input type="number" id="rsQty" value="1" step="1" min="1"></label>
          <label>${esc(T('rst.date'))}<input type="date" id="rsDate" value="${new Date().toISOString().slice(0,10)}"></label>
        </div>
        <h4 class="art-form-section">${esc(T('sec.cost'))}</h4>
        <div class="art-form-grid">
          <label>${esc(T('rst.origin'))} <span class="art-req">*</span><select id="rsOrigin">${(config.costOrigins||[]).map(o=>`<option value="${esc(o.name)}">${esc(o.name)}</option>`).join('')}</select></label>
          <label>${esc(T('rst.cost'))} <span class="art-req">*</span><input type="number" id="rsCost" value="0" step="0.01" min="0"></label>
        </div>
        <h4 class="art-form-section">${esc(T('sec.evidence'))}</h4>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('rst.signature'))}<input type="text" value="${esc(currentActorName())}" readonly style="opacity:0.7; cursor:not-allowed;"></label>
          <label class="art-form-full">${esc(T('prod.bill'))}
            <label class="file-picker">
              <input type="file" id="rsBillInput" accept="image/*,application/pdf">
              <span class="file-picker-btn">${esc(T('io.chooseFile'))}</span>
              <span class="file-picker-name" id="rsBillName">${esc(T('io.noFile'))}</span>
            </label>
          </label>
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="rsCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="rsSave">${esc(T('rst.confirm'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const g = (id)=> ov.querySelector('#'+id);
    let rsBillData = null;
    // Fill product dropdown, optionally filtered by the selected type.
    function fillProducts(){
      const type = g('rsType').value;
      const list = type === 'all' ? products : products.filter(p=> p.productType === type);
      g('rsProduct').innerHTML = list.length === 0
        ? `<option value="">${esc(T('rst.noneInType'))}</option>`
        : `<option value="">${esc(T('rev.pickProduct'))}</option>` + list.map(p=>`<option value="${p.id}">${esc(p.name)}${p.sku?` (${esc(p.sku)})`:''} · ${esc(T('prod.stock'))} ${stockOf(p).remaining}</option>`).join('');
    }
    function fillColors(){
      const prod = products.find(x=> x.id === g('rsProduct').value);
      const cols = (prod && prod.hasColors && Array.isArray(prod.colors)) ? prod.colors : [];
      const field = g('rsColorField');
      if(!cols.length){ field.style.display = 'none'; g('rsColor').innerHTML = ''; return; }
      field.style.display = '';
      g('rsColor').innerHTML = cols.map(c=> `<option value="${esc(c.id)}">${esc(c.name||'-')} \u00B7 ${esc(T('prod.stock'))} ${stockOfColor(prod, c.id).remaining}</option>`).join('');
    }
    g('rsType').addEventListener('change', ()=>{ fillProducts(); fillColors(); });
    g('rsProduct').addEventListener('change', fillColors);
    fillProducts();
    fillColors();
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    g('rsCancel').addEventListener('click', close);
    const rbi = g('rsBillInput');
    if(rbi) rbi.addEventListener('change', (e)=>{
      const file = e.target.files[0]; if(!file){ rsBillData=null; return; }
      if(file.size > 256*1024){ alert(T('bill.tooBig')); e.target.value=''; rsBillData=null; return; }
      const nm = g('rsBillName'); if(nm) nm.textContent = file.name;
      const reader = new FileReader();
      reader.onload = ()=>{ rsBillData = reader.result; };
      reader.readAsDataURL(file);
    });
    g('rsSave').addEventListener('click', async ()=>{
      const productId = g('rsProduct').value;
      const qty = parseInt(g('rsQty').value)||0;
      const signature = currentActorName();
      const date = g('rsDate').value;
      if(!productId){ alert(T('rev.errPickProduct')); return; }
      if(qty <= 0){ alert(T('rst.errQty')); return; }
      const prod = products.find(p=> p.id === productId);
      const origin = g('rsOrigin').value;
      const cost = parseFloat(g('rsCost').value)||0;
      const colorId = (g('rsColorField').style.display === 'none') ? null : (g('rsColor').value || null);
      const colorName = colorId ? ((prod.colors||[]).find(c=> c.id === colorId)||{}).name || '' : '';
      addToLot(productId, origin, cost, qty, signature, colorId);
      stockLog.push({ id: rid(), date, productId, colorId, productName: prod.name + (colorName ? ' \u00B7 ' + colorName : ''), productType: prod.productType||'', qty, signature, type: 'restock', origin, cost, bill: rsBillData, createdAt: new Date().toISOString() });
      postStockExpense({ date, details: T('exp.restockOf').replace('{p}', prod.name + (colorName ? ' \u00B7 ' + colorName : '')), qty, cost, origin, productId, colorId, source:'restock' });
      await saveExpenses();
      await saveLots();
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
              <th>${esc(T('sh.ptype'))}</th><th class="num">${esc(T('sh.qtyAdded'))}</th>
              <th>${esc(T('sh.origin'))}</th><th class="num">${esc(T('sh.cost'))}</th>
              <th>${esc(T('sh.signature'))}</th><th>${esc(T('sh.bill'))}</th><th>${esc(T('sh.verified'))}</th>
            </tr></thead>
            <tbody id="shTbody"></tbody>
            <tfoot><tr><td colspan="4">${esc(T('sh.totalRows'))} (<span id="shCount">0</span>)</td><td class="num" id="shTotal">0</td><td colspan="5"></td></tr></tfoot>
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

  function openBill(dataUrl){
    try{
      const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
      if(!m){ window.open(dataUrl, '_blank'); return; }
      const bin = atob(m[2]); const arr = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([arr], { type: m[1] }));
      window.open(url, '_blank');
      setTimeout(()=> URL.revokeObjectURL(url), 60000);
    }catch(e){ try{ window.open(dataUrl, '_blank'); }catch(_){} }
  }
  function verifyCellHtml(r){
    const on = !!r.verified;
    const canV = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'verifyStock');
    const pill = `<span class="art-pill sh-verify ${canV?'sh-verify-btn':''}" data-verify="${r.id}" style="background:${on?'#6B8F71':'#C6432E'};">${esc(on?T('sh.verYes'):T('sh.verNo'))}</span>`;
    const who = (on && r.verifiedBy) ? `<span class="sh-verify-by">${esc(r.verifiedBy)}</span>` : '';
    return pill + who;
  }
  function renderStockHistTable(body){
    const list = stockHistFiltered().slice().sort((a,b)=>{
      const ta = a.createdAt || (a.date + 'T00:00:00');
      const tb = b.createdAt || (b.date + 'T00:00:00');
      return tb.localeCompare(ta);   // newest first
    });
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
        const dateStr = isNaN(d) ? r.date : (String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear());
        let timeStr = '';
        if(r.createdAt){ const ca = new Date(r.createdAt); if(!isNaN(ca)) timeStr = String(ca.getHours()).padStart(2,'0')+':'+String(ca.getMinutes()).padStart(2,'0'); }
        return `<tr>
          <td>${dateStr}${timeStr?` <span class="sh-time">${timeStr}</span>`:''}</td>
          <td><span class="art-pill" style="background:${r.type==='new'?'#6B8F71':'#C97B4E'}">${esc(r.type==='new'?T('sh.typeNew'):T('sh.typeRestock'))}</span></td>
          <td>${esc(r.productName)}</td>
          <td>${r.productType ? `<span class="art-pill" style="background:${ptypeColor(r.productType)}">${esc(r.productType)}</span>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td class="num art-sold" style="font-weight:700;">+${r.qty}</td>
          <td>${r.origin ? `<span class="art-pill" style="background:${originColor(r.origin)}">${esc(r.origin)}</span>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td class="num">${r.cost != null ? fmt(r.cost) : '-'}</td>
          <td>${esc(r.signature)}</td>
          <td>${r.bill ? `<button type="button" class="sh-bill" data-bill="${r.id}">📎</button>` : '<span style="color:var(--c-muted);">-</span>'}</td>
          <td>${verifyCellHtml(r)}</td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('.sh-bill[data-bill]').forEach(el=> el.addEventListener('click', ()=>{
        const entry = stockLog.find(x=> x.id === el.dataset.bill);
        if(entry && entry.bill) openBill(entry.bill);
      }));
      if((typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'verifyStock')){
        tbody.querySelectorAll('.sh-verify[data-verify]').forEach(el=> el.addEventListener('click', async ()=>{
          const entry = stockLog.find(x=> x.id === el.dataset.verify);
          if(!entry) return;
          entry.verified = !entry.verified;
          entry.verifiedBy = entry.verified ? currentActorName() : '';
          await saveStockLog();
          renderStockHistTable(body);
        }));
      }
    }
    body.querySelector('#shCount').textContent = list.length;
    body.querySelector('#shTotal').textContent = '+' + list.reduce((s,r)=> s+r.qty, 0);
  }

  /* ================= Setting page ================= */
  // Four editable groups — expense tags, revenue tags, order statuses,
  // invoice statuses — each a list of {id,name,color} the user can
  // add / rename / recolour / delete, mirroring the Base App's room editor.
  // Business Profile page — ONLY the issuer info (was bundled with all the tag groups).
  function renderBusinessProfilePage(body){
    const rerender = ()=> renderBusinessProfilePage(body);
    body.innerHTML = `<div class="panel settings-panel">${businessProfileHtml()}</div>`;
    wireBusinessProfile(body, body, rerender);
  }

  // Per-module config pages — each module owns only its own tags/statuses,
  // wrapped in a padded .settings-section so nothing sits flush to the edge.
  function renderConfigShell(groupsHtml){
    return `<div class="panel settings-panel">
        <div class="settings-section">
          <div class="settings-section-head">
            <h3 class="setting-title">${esc(T('set.title'))}</h3>
            <p class="setting-desc">${esc(T('set.desc'))}</p>
          </div>
          <div id="artSetGroups">${groupsHtml}</div>
        </div>
      </div>`;
  }
  function renderStockConfig(body){
    const rerender = ()=> renderStockConfig(body);
    body.innerHTML = renderConfigShell(groupHtml('productTypes', T('set.productTypes')) + groupHtml('costOrigins', T('set.costOrigins')));
    wireGroups(body.querySelector('#artSetGroups'), body, rerender);
  }
  function renderSellConfig(body){
    const rerender = ()=> renderSellConfig(body);
    body.innerHTML = renderConfigShell(
      groupHtml('revenueTags',     T('set.revenueTags')) +
      groupHtml('orderStatuses',   T('set.orderStatuses')) +
      groupHtml('invoiceStatuses', T('set.invoiceStatuses')));
    wireGroups(body.querySelector('#artSetGroups'), body, rerender);
  }
  function renderAcctConfig(body){
    const rerender = ()=> renderAcctConfig(body);
    body.innerHTML = renderConfigShell(
      groupHtml('expenseTags', T('set.expenseTags')) + broughtFromHtml() + prefixHtml());
    const host = body.querySelector('#artSetGroups');
    wireGroups(host, body, rerender);
    wireBroughtFrom(host, body, rerender);
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
          <label class="art-bp-full">${esc(T('bp.nameEn'))}<input type="text" id="bpNameEn" value="${esc(b.nameEn||'')}"></label>
          <label class="art-bp-full">${esc(T('bp.address'))}<textarea id="bpAddress" rows="2">${esc(b.address||'')}</textarea></label>
          <label class="art-bp-full">${esc(T('bp.addressEn'))}<textarea id="bpAddressEn" rows="2">${esc(b.addressEn||'')}</textarea></label>
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
  function wireBusinessProfile(host, body, rerender){
    const b = config.business;
    const bind = (id, key)=>{ const el = host.querySelector('#'+id); if(el) el.addEventListener('input', async ()=>{ b[key] = el.value; await saveConfig(); }); };
    bind('bpName','name'); bind('bpNameEn','nameEn'); bind('bpAddress','address'); bind('bpAddressEn','addressEn'); bind('bpPhone','phone'); bind('bpTaxId','taxId');
    const vat = host.querySelector('#bpVat');
    if(vat) vat.addEventListener('click', async ()=>{
      b.vatDefault = !b.vatDefault;
      vat.classList.toggle('on', b.vatDefault); vat.classList.toggle('off', !b.vatDefault);
      await saveConfig();
    });
    host.querySelectorAll('[data-bpfile]').forEach(inp=> inp.addEventListener('change', (e)=>{
      const key = inp.dataset.bpfile, file = e.target.files[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = async ()=>{ b[key] = reader.result; await saveConfig(); rerender(); };
      reader.readAsDataURL(file);
    }));
    host.querySelectorAll('[data-bpclear]').forEach(btn=> btn.addEventListener('click', async ()=>{
      b[btn.dataset.bpclear] = ''; await saveConfig(); rerender();
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

  function wireBroughtFrom(host, body, rerender){
    const group = host.querySelector('[data-bfgroup]');
    if(!group) return;
    group.querySelector('.art-bf-add').addEventListener('click', async ()=>{
      config.broughtFrom.push({ id: rid(), name: T('set.newItem') });
      await saveConfig(); rerender();
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
        await saveConfig(); rerender();
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
        <input type="text" class="art-set-name" data-field="nameTh" value="${esc(it.nameTh||'')}" placeholder="${esc(it.name||T('set.nameTh'))}">
        <input type="text" class="art-set-name art-set-name-en" data-field="nameEn" value="${esc(it.nameEn||'')}" placeholder="${esc(it.name||T('set.nameEn'))}">
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

  function wireGroups(host, body, rerender){
    host.querySelectorAll('.art-set-group[data-group]').forEach(groupEl=>{
      const groupKey = groupEl.dataset.group;

      // Add
      groupEl.querySelector('.art-set-add').addEventListener('click', async ()=>{
        config[groupKey].push({ id: rid(), name: rid(), nameTh: T('set.newItem'), color: '#FDBD31' });
        await saveConfig();
        rerender();
      });

      // Per-row: rename, recolour, delete
      groupEl.querySelectorAll('.art-set-row').forEach(rowEl=>{
        const id = rowEl.dataset.item;
        const item = config[groupKey].find(x=> x.id === id);
        if(!item) return;

        const _th = rowEl.querySelector('[data-field="nameTh"]');
        if(_th) _th.addEventListener('change', async (e)=>{ item.nameTh = e.target.value.trim(); await saveConfig(); });
        const _en = rowEl.querySelector('[data-field="nameEn"]');
        if(_en) _en.addEventListener('change', async (e)=>{ item.nameEn = e.target.value.trim(); await saveConfig(); });
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
          rerender();
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
      'exp.from': 'จากวันที่', 'exp.to': 'ถึงวันที่', 'exp.tag': 'ป้ายกำกับ', 'exp.all': 'ทั้งหมด',
      'exp.restockOf':'\u0E40\u0E15\u0E34\u0E21\u0E2A\u0E15\u0E4A\u0E2D\u0E01 \u2014 {p}', 'exp.newStockOf':'\u0E2A\u0E15\u0E4A\u0E2D\u0E01\u0E15\u0E31\u0E49\u0E07\u0E15\u0E49\u0E19 \u2014 {p}', 'exp.auto':'\u0E23\u0E30\u0E1A\u0E1A\u0E25\u0E07\u0E43\u0E2B\u0E49', 'exp.clearFilter': 'ล้างตัวกรอง', 'exp.add': '+ เพิ่มรายการ', 'exp.addTitle': 'เพิ่มรายการรายจ่าย', 'exp.editTitle': 'แก้ไขรายการรายจ่าย',
      'exp.id': 'รหัส', 'exp.date': 'วันที่', 'exp.details': 'รายการ', 'exp.costPerPiece': 'ต้นทุน/ชิ้น', 'exp.amount': 'จำนวน',
      'exp.sumItems': 'รวมสินค้า', 'exp.shipping': 'ค่าส่ง', 'exp.discount': 'ส่วนลด', 'exp.net': 'สุทธิ',
      'exp.purchaseFrom': 'ร้าน/ที่ซื้อ', 'exp.pickFrom': '— เลือกแหล่งที่ซื้อ —', 'exp.note': 'หมายเหตุ', 'exp.totalRows': 'รวม', 'exp.empty': 'ยังไม่มีรายการรายจ่าย เริ่มเพิ่มรายการแรกได้เลย',
      'exp.delConfirm': 'ลบรายการนี้?',
      'sum.period': 'ช่วงเวลา', 'sum.allTime': 'ทั้งหมด', 'sum.tag': 'ป้ายกำกับ', 'sum.netTotal': 'ยอดสุทธิ', 'sum.percent': '% ของยอดรวม',
      'sum.sum': 'รวม', 'sum.totalNet': 'รวมรายจ่าย (สุทธิ)', 'sum.count': 'จำนวนรายการ', 'sum.avg': 'เฉลี่ยต่อรายการ', 'sum.byCategory':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E15\u0E32\u0E21\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'sum.byOrigin':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E15\u0E32\u0E21\u0E41\u0E2B\u0E25\u0E48\u0E07\u0E17\u0E35\u0E48\u0E21\u0E32', 'sum.uncategorised':'\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48', 'sum.noOrigin':'\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E41\u0E2B\u0E25\u0E48\u0E07', 'sum.noData': 'ยังไม่มีข้อมูลในช่วงนี้',
      'rev.add': '+ เพิ่มออเดอร์', 'rev.addTitle': 'เพิ่มออเดอร์', 'rev.editTitle': 'แก้ไขออเดอร์',
      'rev.invoiceNo': 'เลขบิล', 'col.lastEdited':'แก้ล่าสุด', 'rev.customer': 'ชื่อผู้รับ', 'rev.customerHint': 'ชื่อ-นามสกุลผู้รับ', 'rev.back':'กลับ', 'rev.mapHint':'หรือกดเลือกจังหวัดจากแผนที่', 'rev.selProvince':'จังหวัดที่เลือก', 'rev.noProvince':'ยังไม่ได้เลือกจังหวัด', 'region.north':'ภาคเหนือ', 'region.central':'ภาคกลาง', 'region.northeast':'ภาคตะวันออกเฉียงเหนือ', 'region.east':'ภาคตะวันออก', 'region.west':'ภาคตะวันตก', 'region.south':'ภาคใต้', 'rev.address': 'ที่อยู่ผู้รับ', 'rev.addressHint': 'ที่อยู่สำหรับจัดส่ง', 'rev.addrLine':'ที่อยู่ (บ้านเลขที่/หมู่/ซอย/ถนน)', 'rev.addrLineHint':'บ้านเลขที่ หมู่ ตรอก/ซอย ถนน', 'rev.province':'จังหวัด', 'rev.district':'อำเภอ/เขต', 'rev.subdistrict':'ตำบล/แขวง', 'rev.postal':'รหัสไปรษณีย์', 'rev.postalHint':'อัตโนมัติ', 'rev.loading':'กำลังโหลด...', 'rev.errAddrLine':'กรุณากรอกที่อยู่ (บ้านเลขที่/ซอย/ถนน)', 'rev.errAddrGeo':'กรุณาเลือกจังหวัด/อำเภอ/ตำบลให้ครบ', 'rev.platform': 'ขายผ่าน Platform', 'rev.platformHint': 'เช่น TikTok Shop', 'sec.delivery':'การจัดส่ง', 'sec.inventory':'รายการสินค้า (Inventory)', 'rev.phone':'เบอร์โทรติดต่อ', 'rev.phoneHint':'เบอร์โทรศัพท์ผู้รับ', 'rev.shippingTitle':'ค่าจัดส่ง', 'rev.shippingCost':'ค่าจัดส่ง', 'rev.shippingOverride':'ตั้งค่าส่งเอง (ทับ auto)', 'rev.shipAuto':'อัตโนมัติ', 'rev.shipNoCat':'ยังไม่มีสินค้า/หมวดหมู่', 'rev.discountsTitle':'ส่วนลด', 'rev.itemDiscount':'ส่วนลดสินค้า', 'rev.shippingDiscount':'ส่วนลดค่าส่ง', 'rev.overallDiscount':'ส่วนลดรวมทั้งบิล', 'rev.totalDiscount':'ส่วนลดรวม', 'rev.deliveryMethod':'วิธีจัดส่ง', 'rev.responsible':'ผู้รับผิดชอบ', 'rev.pickResp':'— เลือก —', 'rev.respHint':'ระบุผู้รับผิดชอบ', 'rev.proofLabel':'หลักฐานการจัดส่ง (Outsource)', 'rev.proofPick':'แนบไฟล์', 'rev.proofAttached':'แนบแล้ว', 'rev.proofNone':'ยังไม่ได้แนบ', 'rev.items': 'รายการสินค้า', 'del.allProvinces':'ทุกจังหวัด', 'del.allRegions':'ทุกภาค', 'del.allStatuses':'ทุกสถานะ', 'del.orderNo':'เลขที่ออเดอร์', 'del.recipient':'ผู้รับ', 'del.province':'จังหวัด', 'del.region':'ภาค', 'del.address':'ที่อยู่', 'del.status':'สถานะจัดส่ง', 'del.shipType':'วิธีจัดส่ง', 'del.responsible':'ผู้รับผิดชอบ', 'del.proof':'หลักฐาน', 'del.verified':'ยืนยัน', 'del.deliveryDate':'วันจัดส่ง', 'nav.productHistory':'ประวัติแก้ไข', 'nav.orderHistory':'ประวัติแก้ไข', 'eh.record':'รายการ', 'eh.changes':'จำนวนครั้ง', 'eh.lastAction':'ล่าสุด', 'eh.lastEdited':'แก้ล่าสุด', 'eh.when':'วันเวลา', 'eh.by':'ผู้ทำ', 'eh.action':'การกระทำ', 'eh.viewRaw':'ดูข้อมูลดิบ', 'eh.back':'กลับ', 'eh.empty':'ยังไม่มีประวัติ', 'eh.rawTitle':'ข้อมูล ณ ตอนนั้น (raw)', 'eh.create':'สร้าง', 'eh.edit':'แก้ไข', 'eh.delete':'ลบ', 'eh.imgChanges':'\u0E01\u0E32\u0E23\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E41\u0E1B\u0E25\u0E07\u0E23\u0E39\u0E1B', 'eh.imgAdded':'\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E23\u0E39\u0E1B', 'eh.imgRemoved':'\u0E25\u0E1A\u0E23\u0E39\u0E1B', 'eh.imgNoName':'(\u0E44\u0E21\u0E48\u0E17\u0E23\u0E32\u0E1A\u0E0A\u0E37\u0E48\u0E2D\u0E44\u0E1F\u0E25\u0E4C)', 'eh.old':'เดิม', 'eh.new':'ใหม่', 'eh.viewDetail':'ดูรายละเอียด', 'eh.items':'รายการสินค้า', 'eh.note':'หมายเหตุ', 'del.empty':'ยังไม่มีรายการจัดส่ง', 'set.deliveryStatuses':'สถานะการจัดส่ง', 'set.shippingTypes':'ประเภทการจัดส่ง (Shipping Type)', 'set.outsources':'ผู้ให้บริการ Outsource', 'set.regionMode':'รูปแบบการแบ่งภูมิภาค', 'nav.grouping':'การจัดกลุ่ม', 'nav.shippingCost':'ค่าจัดส่ง', 'nav.deliveryList':'รายการจัดส่ง', 'nav.deliveryBoard':'สถานะการจัดส่ง', 'nav.deliveryCalendar':'ปฏิทิน', 'cal.driverType':'ประเภทคนขับ', 'cal.driver':'คนขับ', 'cal.allTypes':'ทุกประเภท', 'cal.allDrivers':'ทุกคน', 'cal.today':'วันนี้', 'cal.unscheduled':'ยังไม่กำหนดวัน {n} รายการ', 'cal.colorBy':'สีตาม', 'cal.byStatus':'สถานะ', 'cal.byType':'ประเภทคนขับ', 'cal.byDriver':'ชื่อคนขับ', 'nav.deliveryDrivers':'คนขับ', 'drv.title':'สีของคนขับ', 'drv.desc':'ตั้งสีให้คนขับแต่ละคน — ใช้แสดงในปฏิทินเมื่อเลือกสีตามคนขับ', 'drv.our':'คนขับของร้าน', 'drv.outsource':'Outsource', 'drv.empty':'ยังไม่มีคนขับ (เพิ่มพนักงานประเภท Delivery Driver หรือ Outsource ก่อน)', 'set.shipCost':'ค่าจัดส่ง', 'set.shipCategory':'ประเภทสินค้า (Category)', 'set.shipCostDesc':'ตั้งราคาค่าจัดส่ง — ตามภาค (4/6) หรือรายจังหวัด', 'set.shipMode':'รูปแบบการคิดราคา', 'set.shipByProvince':'รายจังหวัด', 'set.shipProvSwitch':'วิธีตั้งราคารายจังหวัด', 'set.shipException':'ตามภาค + ยกเว้นบางจังหวัด', 'set.shipManual':'ตั้งเองทุกจังหวัด', 'set.shipPickRegion':'เลือกภาค (เพื่อตั้งราคาจังหวัดในภาคนั้น)', 'set.shipRegionBase':'ราคาฐานของภาค', 'set.baht':'บาท', 'set.region4':'4 ภาค', 'set.region6':'6 ภาค', 'set.regionModeHint':'เลือกวิธีแบ่งภูมิภาค — มีผลกับคอลัมน์/ตัวกรอง "ภาค" ในหน้าจัดส่ง และสีแบ่งภาคบนแผนที่ (ไม่ต้องเก็บข้อมูลซ้ำ เพราะภาคคำนวณจากรหัสจังหวัด)',
      'rev.orderStatus': 'สถานะออเดอร์', 'rev.invoiceStatus': 'สถานะใบเสร็จ', 'rev.totalRows': 'รวม',
      'rev.empty': 'ยังไม่มีออเดอร์ เริ่มเพิ่มออเดอร์แรกได้เลย', 'rev.delConfirm': 'ลบออเดอร์นี้?',
      'rev.addItem': '+ เพิ่มสินค้า', 'rev.itemName': 'ชื่อสินค้า', 'rev.itemProduct': 'สินค้า', 'rev.itemQty': 'จำนวน', 'rev.itemDisc': 'ส่วนลด', 'rev.itemNet': 'สุทธิ', 'rev.itemPrice': 'ราคา', 'rev.itemsTotal': 'รวมสินค้า',
      'rev.errCustomer': 'กรุณากรอกชื่อผู้รับ', 'rev.errAddress': 'กรุณากรอกที่อยู่ผู้รับ', 'rev.errItems': 'กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'rev.errPickProduct': 'กรุณาเลือกสินค้าจากรายการที่มีเท่านั้น', 'rev.pickProduct': '— เลือกสินค้า —', 'rev.noProducts': 'ยังไม่มีสินค้าในระบบ กรุณาเพิ่มสินค้าในหน้าจัดการสินค้าก่อนนะคะ',
      'prod.pinTitle': 'หน้านี้ต้องใส่ PIN', 'prod.pinDesc': 'กรอกรหัส PIN 6 หลักเพื่อจัดการสินค้า', 'prod.pinWrong': 'PIN ไม่ถูกต้องค่ะ ลองใหม่อีกครั้ง', 'prod.pinClear': 'ล้าง',
      'prod.restock': '+ เติมสต๊อก', 'prod.add': '+ เพิ่มสินค้า',
      'rst.title': 'เติมสต๊อกสินค้า', 'rst.ptype': 'หมวดหมู่', 'rst.allTypes': 'ทั้งหมด', 'rst.noneInType': 'ไม่มีสินค้าในหมวดหมู่นี้', 'rst.product': 'สินค้า', 'rst.qty': 'จำนวนที่เติม', 'rst.date': 'วันที่', 'rst.signature': 'ผู้เติม (Signature)', 'rst.signatureHint': 'พิมพ์ชื่อคุณ', 'rst.origin':'แหล่งต้นทุน', 'rst.cost':'ต้นทุน/ชิ้น', 'alloc.title':'ต้นทุนที่ใช้ (เลือกจาก lot)', 'alloc.add':'+ เพิ่มแหล่งต้นทุน', 'alloc.pickOrigin':'— แหล่ง —', 'alloc.pickLot':'— เลือกราคา —', 'alloc.qty':'จำนวน', 'alloc.left':'เหลือ', 'alloc.errSum':'สินค้า {p}: จำนวนต้นทุนที่เลือก ({a}) ไม่ตรงกับจำนวนขาย ({q})', 'alloc.errOver':'เลือกเกินจำนวนคงเหลือของ lot ({o} ฿{c})', 'rst.confirm': 'ยืนยันเติมสต๊อก',
      'rst.errQty': 'จำนวนต้องมากกว่า 0', 'rst.errSign': 'กรุณาพิมพ์ชื่อผู้เติม',
      'sh.product': 'สินค้า', 'sh.action': 'ประเภท', 'sh.ptype': 'หมวดหมู่', 'sh.type': 'ประเภท', 'sh.typeRestock': 'เติมสต๊อก', 'sh.typeNew': 'สินค้าใหม่', 'sh.qty': 'จำนวน', 'sh.any': 'ทั้งหมด', 'sh.gt': 'มากกว่า', 'sh.lt': 'น้อยกว่า', 'sh.eq': 'เท่ากับ', 'sh.qtyVal': 'จำนวน',
      'sh.origin':'แหล่ง', 'sh.cost':'ต้นทุน', 'sh.bill':'บิล', 'sh.verified':'ยืนยัน', 'sh.verYes':'ยืนยันแล้ว', 'sh.verNo':'ยังไม่ยืนยัน', 'sh.signature': 'ผู้เติม', 'sh.signHint': 'ค้นชื่อ', 'sh.qtyAdded': 'จำนวนที่เติม', 'sh.totalRows': 'รวม', 'sh.empty': 'ยังไม่มีประวัติการเติมสต๊อก',
      'io.exportTitle': 'ส่งออกข้อมูล Simple Store', 'io.exportDesc': 'ดาวน์โหลดข้อมูลทั้งหมด (รายจ่าย/ออเดอร์/สินค้า/ตั้งค่า/ประวัติสต๊อก) เป็นไฟล์ JSON — ไฟล์เดียวกู้กลับได้ครบ',
      'io.json': 'ดาวน์โหลด JSON (สำรองทั้งหมด)', 'io.importTitle': 'นำเข้าข้อมูล Simple Store', 'io.importDesc': 'อัปโหลดไฟล์ JSON ที่สำรองไว้ — จะแทนที่ข้อมูล Simple Store ทั้งหมด (ไม่ใช่การรวม)',
      'io.chooseFile': 'เลือกไฟล์', 'io.noFile': 'ยังไม่ได้เลือกไฟล์', 'io.importBtn': 'นำเข้า',
      'io.replaceWarn': 'การนำเข้าจะแทนที่ข้อมูล Simple Store ทั้งหมด (ปัจจุบันมี {n} รายการ) — ยืนยันหรือไม่?',
      'io.importDone': 'นำเข้าสำเร็จ', 'io.importFail': 'นำเข้าล้มเหลว — ไฟล์ไม่ถูกต้อง',
      'io.csvExportLabel': 'หรือส่งออกทีละตารางเป็น CSV (เปิดด้วย Excel ได้):', 'io.csvExp': 'CSV รายจ่าย', 'io.csvOrd': 'CSV ออเดอร์', 'io.csvProd': 'CSV สินค้า',
      'io.importNote': '⚠️ นำเข้า CSV ได้เฉพาะ รายจ่าย และ สินค้า เท่านั้น (รหัสใหม่=สร้าง · รหัสเดิม=แก้ไข · ใส่ delete ในคอลัมน์ action=ลบ) — ส่วนออเดอร์นำเข้าได้เฉพาะไฟล์ JSON (เพราะรายการสินค้าผูกกับรหัสสินค้า)',
      'io.csvDone': 'นำเข้า {t} สำเร็จ — สร้าง {c} · แก้ไข {u} · ลบ {d}', 'io.tbl_expenses': 'รายจ่าย', 'io.tbl_products': 'สินค้า', 'prod.addTitle': 'เพิ่มสินค้า', 'prod.editTitle': 'แก้ไขสินค้า',
      'img.max5':'\u0E2A\u0E39\u0E07\u0E2A\u0E38\u0E14 5 \u0E23\u0E39\u0E1B', 'pc.pickColor':'\u2014 \u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E35 \u2014', 'rev.pickColorFirst':'\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E35\u0E01\u0E48\u0E2D\u0E19 \u0E08\u0E36\u0E07\u0E08\u0E30\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E41\u0E2B\u0E25\u0E48\u0E07\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E44\u0E14\u0E49', 'rev.errPickColor':'\u0E01\u0E23\u0E38\u0E13\u0E32\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E35\u0E02\u0E2D\u0E07 {p}', 'pc.noColor':'\u0E44\u0E21\u0E48\u0E23\u0E30\u0E1A\u0E38\u0E2A\u0E35', 'pc.colorLabel':'\u0E2A\u0E35', 'prod.desc':'\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'prod.descPh':'\u0E04\u0E33\u0E2D\u0E18\u0E34\u0E1A\u0E32\u0E22\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 \u0E27\u0E31\u0E2A\u0E14\u0E38 \u0E02\u0E19\u0E32\u0E14 \u0E01\u0E32\u0E23\u0E14\u0E39\u0E41\u0E25 ฯลฯ', 'pc.section':'\u0E41\u0E1A\u0E1A\u0E2A\u0E35', 'pc.enable':'\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E19\u0E35\u0E49\u0E21\u0E35\u0E41\u0E1A\u0E1A\u0E2A\u0E35', 'pc.add':'+ \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E2A\u0E35', 'pc.namePh':'\u0E0A\u0E37\u0E48\u0E2D\u0E2A\u0E35', 'pc.image':'\u0E23\u0E39\u0E1B\u0E02\u0E2D\u0E07\u0E2A\u0E35\u0E19\u0E35\u0E49', 'pc.rmImage':'\u0E40\u0E2D\u0E32\u0E23\u0E39\u0E1B\u0E2D\u0E2D\u0E01', 'prod.image': 'รูป', 'sec.detail':'รายละเอียดสินค้า', 'sec.cost':'ต้นทุน', 'sec.selling':'การขาย', 'sec.evidence':'หลักฐาน', 'sec.product':'สินค้า', 'sec.order':'ออเดอร์', 'sec.customer':'ลูกค้า', 'prod.bill':'ใบซื้อ/บิล', 'bill.tooBig':'ไฟล์ใหญ่เกิน 256KB', 'prod.sku': 'รหัสสินค้า', 'prod.name': 'ชื่อสินค้า', 'prod.cost': 'ต้นทุน', 'prod.price': 'ราคาขาย',
      'prod.sale': 'ลดราคา',
      'promo.btn': 'โปรโมชั่น', 'promo.navLabel': 'โปรโมชัน',
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
      'prod.stock': 'สต๊อก', 'prod.origin':'แหล่งต้นทุน (สต๊อกเปิด)', 'prod.noLots':'ยังไม่มี lot', 'prod.unit':'ชิ้น', 'prod.reserved': 'จองแล้ว', 'prod.sold': 'ขายแล้ว', 'prod.ptype': 'หมวดหมู่', 'prod.pickType': '— เลือกหมวดหมู่ —', 'prod.errType': 'กรุณาเลือกหมวดหมู่', 'prod.tag': 'สถานะ', 'prod.empty': 'ยังไม่มีสินค้าในระบบ เริ่มเพิ่มสินค้าแรกได้เลย',
      'prod.delConfirm': 'ลบสินค้านี้? (ออเดอร์เก่าจะยังเก็บชื่อ/ราคาไว้ตามเดิม)', 'prod.errSku': 'กรุณากรอกรหัสสินค้า', 'prod.errName': 'กรุณากรอกชื่อสินค้า', 'exp.errDetails': 'กรุณากรอกรายละเอียดรายการ', 'exp.errDate': 'กรุณาเลือกวันที่', 'exp.errAmount': 'จำนวนต้องมากกว่า 0',
      'nav.expense': 'รายจ่าย', 'nav.summary': 'สรุปต้นทุน', 'nav.revenue': 'รายรับ/ออกบิล',
      'nav.orderStatus': 'สถานะออเดอร์', 'nav.invoiceStatus': 'สถานะใบเสร็จ',
      'nav.products': 'จัดการสินค้า', 'nav.stockHistory': 'ประวัติเติมสต๊อก', 'nav.setting': 'ตั้งค่า', 'nav.stockConfig':'สต๊อก', 'nav.sellConfig':'การขาย', 'nav.acctConfig':'ตั้งค่า',
      'set.title': 'ตั้งค่า', 'set.desc': 'จัดการหัวข้อและสีของ Tag และสถานะต่าง ๆ — เพิ่ม แก้ไข เปลี่ยนสี หรือลบได้',
      'set.expenseTags': 'Tag รายจ่าย', 'set.revenueTags': 'Tag รายรับ/ออกบิล',
      'set.orderStatuses': 'สถานะออเดอร์', 'set.invoiceStatuses': 'สถานะใบเสร็จ',
      'set.add': '+ เพิ่ม', 'set.nameTh':'ชื่อ (TH)', 'set.nameEn':'ชื่อ (EN)', 'set.none': 'ยังไม่มีรายการ', 'set.newItem': 'รายการใหม่',
      'set.delConfirm': 'ลบรายการนี้?', 'set.lockedHint': 'สถานะนี้ใช้ตัดสต๊อก แก้ชื่อ/สีได้ แต่ลบไม่ได้',
      'set.broughtFrom': 'แหล่งที่ซื้อ (Brought From)', 'set.productTypes': 'หมวดหมู่สินค้า', 'set.costOrigins': 'แหล่งต้นทุน (Cost Origin)', 'set.prefixTitle': 'รหัสนำหน้า ID', 'set.prefixDesc': 'กำหนดตัวอักษรนำหน้ารหัส (ไม่เกิน 4 ตัว) สำหรับรายจ่ายและออเดอร์',
      'set.prefixExpense': 'นำหน้ารหัสรายจ่าย', 'set.prefixOrder': 'นำหน้าเลขบิลออเดอร์',
      'kb.empty': 'ไม่มีออเดอร์', 'kb.completeHint': 'ลากออเดอร์มาที่นี่ → ย้ายไปหน้า Completed อัตโนมัติ', 'kb.paidHint': 'ลากออเดอร์มาที่นี่ → ทำเครื่องหมายจ่ายครบ (ตัดสต๊อกเป็น Sold)',
      'bp.title': 'ข้อมูลร้าน (สำหรับออกเอกสาร)', 'bp.desc': 'ใช้เป็นหัวเอกสารการเงินทุกใบ (ใบสำคัญรับเงิน ฯลฯ)',
      'bp.name': 'ชื่อร้าน / ผู้ประกอบการ (TH)', 'bp.nameEn': 'ชื่อร้าน / ผู้ประกอบการ (EN)', 'bp.address': 'ที่อยู่ (TH)', 'bp.addressEn': 'ที่อยู่ (EN)', 'bp.phone': 'เบอร์ติดต่อ', 'bp.taxId': 'เลขประจำตัวผู้เสียภาษี (ถ้ามี)',
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
      'doc.subtotal': 'รวมเป็นเงิน', 'doc.discount': 'ส่วนลด', 'doc.shipping':'ค่าจัดส่ง', 'doc.itemDiscount':'ส่วนลดสินค้า', 'doc.shipDiscount':'ส่วนลดค่าส่ง', 'doc.overallDiscount':'ส่วนลดรวมบิล', 'doc.totalDiscount':'ส่วนลดทั้งหมด', 'doc.showDiscounts':'แสดงส่วนลด', 'doc.discItem':'สินค้า', 'doc.discShip':'ค่าส่ง', 'doc.discOverall':'รวมบิล', 'doc.language':'ภาษาเอกสาร', 'doc.langTh':'ไทย', 'doc.langEn':'อังกฤษ', 'doc.beforeVat': 'มูลค่าก่อน VAT', 'doc.vat7': 'ภาษีมูลค่าเพิ่ม 7%', 'doc.grand': 'รวมทั้งสิ้น',
      'doc.amountWords': 'จำนวนเงิน (ตัวอักษร)', 'doc.payer': 'ลงชื่อผู้จ่ายเงิน', 'doc.payee': 'ลงชื่อผู้รับเงิน', 'doc.footNote': 'เอกสารนี้ออกจากระบบ Simple Store',
      'nav.account': 'รายงานรายเดือน', 'nav.deleted':'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E25\u0E1A', 'bin.desc':'\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E25\u0E1A\u0E08\u0E30\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E19\u0E31\u0E1A\u0E23\u0E27\u0E21\u0E43\u0E19\u0E22\u0E2D\u0E14\u0E43\u0E14 \u0E46 \u0E08\u0E19\u0E01\u0E27\u0E48\u0E32\u0E08\u0E30\u0E01\u0E39\u0E49\u0E04\u0E37\u0E19', 'bin.products':'\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E25\u0E1A', 'bin.orders':'\u0E1A\u0E34\u0E25\u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E25\u0E1A', 'bin.restore':'\u0E01\u0E39\u0E49\u0E04\u0E37\u0E19', 'bin.confirm':'\u0E01\u0E39\u0E49\u0E04\u0E37\u0E19\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E19\u0E35\u0E49\u0E01\u0E25\u0E31\u0E1A\u0E44\u0E1B\u0E23\u0E27\u0E21\u0E43\u0E19\u0E22\u0E2D\u0E14\u0E2B\u0E25\u0E31\u0E01?', 'bin.qty':'\u0E08\u0E33\u0E19\u0E27\u0E19\u0E04\u0E07\u0E40\u0E2B\u0E25\u0E37\u0E2D', 'bin.lotValue':'\u0E21\u0E39\u0E25\u0E04\u0E48\u0E32\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19', 'bin.expenses':'\u0E23\u0E32\u0E22\u0E08\u0E48\u0E32\u0E22\u0E17\u0E35\u0E48\u0E1E\u0E48\u0E27\u0E07', 'bin.deletedBy':'\u0E25\u0E1A\u0E42\u0E14\u0E22', 'bin.empty':'\u0E44\u0E21\u0E48\u0E21\u0E35\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23', 'acct.cogs':'\u0E15\u0E49\u0E19\u0E17\u0E38\u0E19\u0E02\u0E32\u0E22', 'acct.profit':'\u0E01\u0E33\u0E44\u0E23\u0E15\u0E48\u0E2D\u0E1A\u0E34\u0E25', 'nav.vat':'\u0E04\u0E33\u0E19\u0E27\u0E13 VAT', 'vat.base':'\u0E01\u0E48\u0E2D\u0E19 VAT', 'vat.amount':'VAT 7%', 'vat.totalNet':'\u0E22\u0E2D\u0E14\u0E23\u0E27\u0E21', 'vat.totalBase':'\u0E23\u0E27\u0E21\u0E01\u0E48\u0E2D\u0E19 VAT', 'vat.totalVat':'VAT \u0E23\u0E27\u0E21', 'nav.ledger': 'สมุดบัญชี (Ledger)', 'acct.summary': 'สรุป', 'acct.table': 'รายการ (Table)', 'acct.monthlyTitle': 'รายรับรายจ่ายรายเดือน',
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
      'exp.restockOf':'Restock \u2014 {p}', 'exp.newStockOf':'Opening stock \u2014 {p}', 'exp.auto':'Auto', 'exp.clearFilter': 'Clear filter', 'exp.add': '+ Add entry', 'exp.addTitle': 'Add expense', 'exp.editTitle': 'Edit expense',
      'exp.id': 'ID', 'exp.date': 'Date', 'exp.details': 'Item', 'exp.costPerPiece': 'Cost/pc', 'exp.amount': 'Qty',
      'exp.sumItems': 'Items total', 'exp.shipping': 'Shipping', 'exp.discount': 'Discount', 'exp.net': 'Net',
      'exp.purchaseFrom': 'Bought from', 'exp.pickFrom': '— Select source —', 'exp.note': 'Note', 'exp.totalRows': 'Total', 'exp.empty': 'No expenses yet — add your first entry',
      'exp.delConfirm': 'Delete this entry?',
      'sum.period': 'Period', 'sum.allTime': 'All time', 'sum.tag': 'Tag', 'sum.netTotal': 'Net Total', 'sum.percent': '% of total',
      'sum.sum': 'Sum', 'sum.totalNet': 'Total expenses (net)', 'sum.count': 'Entries', 'sum.avg': 'Average per entry', 'sum.byCategory':'Cost by product category', 'sum.byOrigin':'Cost by cost origin', 'sum.uncategorised':'Uncategorised', 'sum.noOrigin':'No origin', 'sum.noData': 'No data in this period yet',
      'rev.add': '+ Add order', 'rev.addTitle': 'Add order', 'rev.editTitle': 'Edit order',
      'rev.invoiceNo': 'Invoice #', 'col.lastEdited':'Last edited', 'rev.customer': 'Recipient', 'rev.customerHint': 'Recipient full name', 'rev.back':'Back', 'rev.mapHint':'Or pick a province on the map', 'rev.selProvince':'Selected province', 'rev.noProvince':'No province selected', 'region.north':'North', 'region.central':'Central', 'region.northeast':'Northeast', 'region.east':'East', 'region.west':'West', 'region.south':'South', 'rev.address': 'Recipient address', 'rev.addressHint': 'Shipping address', 'rev.addrLine':'Address (no./soi/road)', 'rev.addrLineHint':'House no., moo, soi, road', 'rev.province':'Province', 'rev.district':'District', 'rev.subdistrict':'Subdistrict', 'rev.postal':'Postal code', 'rev.postalHint':'Auto', 'rev.loading':'Loading...', 'rev.errAddrLine':'Please enter the address line', 'rev.errAddrGeo':'Please select province/district/subdistrict', 'rev.platform': 'Sold via Platform', 'rev.platformHint': 'e.g. TikTok Shop', 'sec.delivery':'Delivery', 'sec.inventory':'Inventory', 'rev.phone':'Phone', 'rev.phoneHint':'Contact phone', 'rev.shippingTitle':'Shipping', 'rev.shippingCost':'Shipping', 'rev.shippingOverride':'Override shipping (manual)', 'rev.shipAuto':'Auto', 'rev.shipNoCat':'No products/categories yet', 'rev.discountsTitle':'Discounts', 'rev.itemDiscount':'Item Discount', 'rev.shippingDiscount':'Shipping Discount', 'rev.overallDiscount':'Overall Discount', 'rev.totalDiscount':'Total Discount', 'rev.deliveryMethod':'Delivery Method', 'rev.responsible':'Responsible', 'rev.pickResp':'— select —', 'rev.respHint':'Enter responsible', 'rev.proofLabel':'Delivery proof (Outsource)', 'rev.proofPick':'Attach file', 'rev.proofAttached':'Attached', 'rev.proofNone':'No file', 'rev.items': 'Items', 'del.allProvinces':'All provinces', 'del.allRegions':'All regions', 'del.allStatuses':'All statuses', 'del.orderNo':'Order #', 'del.recipient':'Recipient', 'del.province':'Province', 'del.region':'Region', 'del.address':'Address', 'del.status':'Delivery status', 'del.shipType':'Shipping Type', 'del.responsible':'Responsible', 'del.proof':'Proof', 'del.verified':'Verified', 'del.deliveryDate':'Delivery Date', 'nav.productHistory':'Edit History', 'nav.orderHistory':'Edit History', 'eh.record':'Record', 'eh.changes':'Changes', 'eh.lastAction':'Latest', 'eh.lastEdited':'Last edited', 'eh.when':'When', 'eh.by':'By', 'eh.action':'Action', 'eh.viewRaw':'View raw', 'eh.back':'Back', 'eh.empty':'No history yet', 'eh.rawTitle':'Snapshot (raw)', 'eh.create':'Created', 'eh.edit':'Edited', 'eh.delete':'Deleted', 'eh.imgChanges':'Image changes', 'eh.imgAdded':'Added', 'eh.imgRemoved':'Removed', 'eh.imgNoName':'(file name unknown)', 'eh.old':'Old', 'eh.new':'New', 'eh.viewDetail':'View detail', 'eh.items':'Items', 'eh.note':'Note', 'del.empty':'No deliveries yet', 'set.deliveryStatuses':'Delivery Statuses', 'set.shippingTypes':'Shipping Type', 'set.outsources':'Outsource providers', 'set.regionMode':'Region Grouping', 'nav.grouping':'Grouping', 'nav.shippingCost':'Shipping Cost', 'nav.deliveryList':'Delivery List', 'nav.deliveryBoard':'Delivery Status', 'nav.deliveryCalendar':'Calendar', 'cal.driverType':'Driver Type', 'cal.driver':'Driver', 'cal.allTypes':'All types', 'cal.allDrivers':'All drivers', 'cal.today':'Today', 'cal.unscheduled':'{n} unscheduled', 'cal.colorBy':'Color by', 'cal.byStatus':'Status', 'cal.byType':'Driver Type', 'cal.byDriver':'Driver', 'nav.deliveryDrivers':'Drivers', 'drv.title':'Driver colours', 'drv.desc':'Set a colour per driver — used in the calendar when colouring by driver', 'drv.our':'Our Driver', 'drv.outsource':'Outsource', 'drv.empty':'No drivers yet (add Delivery Driver employees or Outsources first)', 'set.shipCost':'Shipping Cost', 'set.shipCategory':'Product category', 'set.shipCostDesc':'Set shipping prices — by region (4/6) or per province', 'set.shipMode':'Pricing mode', 'set.shipByProvince':'Per province', 'set.shipProvSwitch':'Per-province method', 'set.shipException':'Region base + exceptions', 'set.shipManual':'Every province manually', 'set.shipPickRegion':'Pick a region (to set its provinces)', 'set.shipRegionBase':'Region base price', 'set.baht':'THB', 'set.region4':'4 regions', 'set.region6':'6 regions', 'set.regionModeHint':'How provinces group into regions — affects the Region column/filter in Delivery and the map colours (derived from province code, no duplicate data).',
      'rev.orderStatus': 'Order Status', 'rev.invoiceStatus': 'Invoice Status', 'rev.totalRows': 'Total',
      'rev.empty': 'No orders yet — add your first order', 'rev.delConfirm': 'Delete this order?',
      'rev.addItem': '+ Add item', 'rev.itemName': 'Product name', 'rev.itemProduct': 'Product', 'rev.itemQty': 'Qty', 'rev.itemDisc': 'Disc', 'rev.itemNet': 'Net', 'rev.itemPrice': 'Price', 'rev.itemsTotal': 'Items total',
      'rev.errCustomer': 'Please enter recipient name', 'rev.errAddress': 'Please enter recipient address', 'rev.errItems': 'Please add at least one item', 'rev.errPickProduct': 'Please pick products from the list only', 'rev.pickProduct': '— Select product —', 'rev.noProducts': 'No products yet — please add products first in the Products page',
      'prod.pinTitle': 'This page needs a PIN', 'prod.pinDesc': 'Enter your 6-digit PIN to manage products', 'prod.pinWrong': 'Wrong PIN, please try again', 'prod.pinClear': 'Clear',
      'prod.restock': '+ Restock', 'prod.add': '+ Add product',
      'rst.title': 'Restock product', 'rst.ptype': 'Category', 'rst.allTypes': 'All categories', 'rst.noneInType': 'No products in this category', 'rst.product': 'Product', 'rst.qty': 'Quantity added', 'rst.date': 'Date', 'rst.signature': 'Added by (Signature)', 'rst.signatureHint': 'Type your name', 'rst.origin':'Cost Origin', 'rst.cost':'Cost/unit', 'alloc.title':'Cost used (pick from lots)', 'alloc.add':'+ Add cost source', 'alloc.pickOrigin':'— Origin —', 'alloc.pickLot':'— Pick price —', 'alloc.qty':'Qty', 'alloc.left':'left', 'alloc.errSum':'{p}: allocated cost qty ({a}) does not match sold qty ({q})', 'alloc.errOver':'Exceeds lot remaining ({o} ฿{c})', 'rst.confirm': 'Confirm restock',
      'rst.errQty': 'Quantity must be greater than 0', 'rst.errSign': 'Please enter your name',
      'sh.product': 'Product', 'sh.action': 'Action', 'sh.ptype': 'Category', 'sh.type': 'Type', 'sh.typeRestock': 'Restock', 'sh.typeNew': 'New Product', 'sh.qty': 'Qty', 'sh.any': 'Any', 'sh.gt': 'Greater than', 'sh.lt': 'Less than', 'sh.eq': 'Equals', 'sh.qtyVal': 'Qty',
      'sh.origin':'Origin', 'sh.cost':'Cost', 'sh.bill':'Bill', 'sh.verified':'Verified', 'sh.verYes':'Verified', 'sh.verNo':'Unverified', 'sh.signature': 'Added by', 'sh.signHint': 'Search name', 'sh.qtyAdded': 'Qty added', 'sh.totalRows': 'Total', 'sh.empty': 'No restock history yet',
      'io.exportTitle': 'Export Simple Store data', 'io.exportDesc': 'Download everything (expenses/orders/products/settings/stock history) as a JSON file — one file restores it all',
      'io.json': 'Download JSON (full backup)', 'io.importTitle': 'Import Simple Store data', 'io.importDesc': 'Upload a JSON backup — this REPLACES all Simple Store data (not a merge)',
      'io.chooseFile': 'Choose file', 'io.noFile': 'No file chosen', 'io.importBtn': 'Import',
      'io.replaceWarn': 'Import will REPLACE all Simple Store data (currently {n} records) — continue?',
      'io.importDone': 'Import successful', 'io.importFail': 'Import failed — invalid file',
      'io.csvExportLabel': 'Or export a single table as CSV (opens in Excel):', 'io.csvExp': 'Expenses CSV', 'io.csvOrd': 'Orders CSV', 'io.csvProd': 'Products CSV',
      'io.importNote': '⚠️ CSV import works for Expenses and Products only (new id=create · existing id=update · action=delete to remove) — Orders can only be imported via JSON (items bind to product IDs)',
      'io.csvDone': 'Imported {t} — created {c} · updated {u} · deleted {d}', 'io.tbl_expenses': 'Expenses', 'io.tbl_products': 'Products', 'prod.addTitle': 'Add product', 'prod.editTitle': 'Edit product',
      'img.max5':'Up to 5 images', 'pc.pickColor':'\u2014 pick a colour \u2014', 'rev.pickColorFirst':'Pick a colour first to choose its cost lots', 'rev.errPickColor':'Please pick a colour for {p}', 'pc.noColor':'No colour', 'pc.colorLabel':'Colour', 'prod.desc':'Product description', 'prod.descPh':'Details, material, size, care instructions, etc.', 'pc.section':'Colour options', 'pc.enable':'This product comes in colours', 'pc.add':'+ Add colour', 'pc.namePh':'Colour name', 'pc.image':'Image for this colour', 'pc.rmImage':'Remove image', 'prod.image': 'Image', 'sec.detail':'Product Detail', 'sec.cost':'Cost', 'sec.selling':'Selling', 'sec.evidence':'Evidence', 'sec.product':'Product', 'sec.order':'Order', 'sec.customer':'Customer', 'prod.bill':'Purchase bill', 'bill.tooBig':'File exceeds 256KB', 'prod.sku': 'SKU', 'prod.name': 'Product name', 'prod.cost': 'Cost', 'prod.price': 'Price',
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
      'prod.stock': 'Stock', 'prod.origin':'Cost Origin (opening)', 'prod.noLots':'No lots yet', 'prod.unit':'pcs', 'prod.reserved': 'Reserved', 'prod.sold': 'Sold', 'prod.ptype': 'Category', 'prod.pickType': '— Select category —', 'prod.errType': 'Please select a category', 'prod.tag': 'Status', 'prod.empty': 'No products yet — add your first one',
      'prod.delConfirm': 'Delete this product? (past orders keep their name/price)', 'prod.errSku': 'Please enter a SKU', 'prod.errName': 'Please enter a product name', 'exp.errDetails': 'Please enter item details', 'exp.errDate': 'Please pick a date', 'exp.errAmount': 'Quantity must be greater than 0',
      'nav.expense': 'Expenses', 'nav.summary': 'Cost Summary', 'nav.revenue': 'Revenue / Billing',
      'nav.orderStatus': 'Order Status', 'nav.invoiceStatus': 'Invoice Status',
      'nav.products': 'Products', 'nav.stockHistory': 'Stock History', 'nav.setting': 'Settings', 'nav.stockConfig':'Stock', 'nav.sellConfig':'Sell', 'nav.acctConfig':'Settings',
      'set.title': 'Settings', 'set.desc': 'Manage the labels and colours of your tags and statuses — add, rename, recolour or delete.',
      'set.expenseTags': 'Expense Tags', 'set.revenueTags': 'Revenue / Billing Tags',
      'set.orderStatuses': 'Order Statuses', 'set.invoiceStatuses': 'Invoice Statuses',
      'set.add': '+ Add', 'set.nameTh':'Name (TH)', 'set.nameEn':'Name (EN)', 'set.none': 'No items yet', 'set.newItem': 'New item',
      'set.delConfirm': 'Delete this item?', 'set.lockedHint': 'This status drives stock — rename/recolour allowed, but cannot be deleted',
      'set.broughtFrom': 'Brought From', 'set.productTypes': 'Categories', 'set.costOrigins': 'Cost Origin', 'set.prefixTitle': 'ID Prefixes', 'set.prefixDesc': 'Set the leading code (max 4 chars) for expenses and orders',
      'set.prefixExpense': 'Expense ID prefix', 'set.prefixOrder': 'Order invoice prefix',
      'kb.empty': 'No orders', 'kb.completeHint': 'Drop an order here → moves to Completed page automatically', 'kb.paidHint': 'Drop an order here → mark as paid (counts as Sold)',
      'bp.title': 'Business Profile (for documents)', 'bp.desc': 'Used as the header on every financial document (receipt voucher, etc.)',
      'bp.name': 'Store / business name (TH)', 'bp.nameEn': 'Store / business name (EN)', 'bp.address': 'Address (TH)', 'bp.addressEn': 'Address (EN)', 'bp.phone': 'Contact phone', 'bp.taxId': 'Tax ID (if any)',
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
      'doc.subtotal': 'Subtotal', 'doc.discount': 'Discount', 'doc.shipping':'Shipping', 'doc.itemDiscount':'Item Discount', 'doc.shipDiscount':'Shipping Discount', 'doc.overallDiscount':'Overall Discount', 'doc.totalDiscount':'Total Discount', 'doc.showDiscounts':'Show discounts', 'doc.discItem':'Item', 'doc.discShip':'Shipping', 'doc.discOverall':'Overall', 'doc.language':'Document language', 'doc.langTh':'Thai', 'doc.langEn':'English', 'doc.beforeVat': 'Before VAT', 'doc.vat7': 'VAT 7%', 'doc.grand': 'Grand total',
      'doc.amountWords': 'Amount in words', 'doc.payer': 'Payer signature', 'doc.payee': 'Payee signature', 'doc.footNote': 'Issued from Simple Store',
      'nav.account': 'Monthly Report', 'nav.deleted':'Deleted List', 'bin.desc':'Deleted records are excluded from every total until they are restored', 'bin.products':'Deleted products', 'bin.orders':'Deleted bills', 'bin.restore':'Restore', 'bin.confirm':'Restore this record back into the books?', 'bin.qty':'Qty held', 'bin.lotValue':'Cost value', 'bin.expenses':'Expenses held', 'bin.deletedBy':'Deleted by', 'bin.empty':'Nothing here', 'acct.cogs':'COGS', 'acct.profit':'Profit', 'nav.vat':'VAT Calculation', 'vat.base':'Before VAT', 'vat.amount':'VAT 7%', 'vat.totalNet':'Total', 'vat.totalBase':'Total before VAT', 'vat.totalVat':'Total VAT', 'nav.ledger': 'Ledger', 'acct.summary': 'Summary', 'acct.table': 'Table', 'acct.monthlyTitle': 'Monthly income & expense',
      'acct.year': 'Year', 'acct.month': 'Month', 'acct.income': 'Income', 'acct.expense': 'Expense', 'acct.net': 'Net', 'acct.yearNet': 'Year net',
      'acct.vatMode': 'VAT calculation', 'acct.vatAll': 'VAT on all', 'acct.vatTicked': 'Only ticked items', 'acct.vatNone': 'No VAT',
      'acct.outVat': 'Output VAT (income)', 'acct.inVat': 'Input VAT (expense)', 'acct.vatNet': 'Net VAT (out−in)', 'acct.byMonth': 'By month (full year)',
      'acct.date': 'Date', 'acct.type': 'Type', 'acct.item': 'Item', 'acct.amount': 'Amount', 'acct.vatable': 'VAT',
      'acct.tableNote': 'Tick items to include in VAT (used by the "Only ticked items" mode)', 'acct.noItems': 'No items yet'
    }
  });
})();
