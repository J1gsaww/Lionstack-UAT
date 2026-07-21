/* ============================================================================
 * ARCHIVED ACCOUNTING SUBPAGES — extracted from js/modules/store-core.js
 * ----------------------------------------------------------------------------
 * NOT LOADED BY THE APP. Kept as reference while the accounting section is
 * rebuilt from scratch.
 *
 * What is in here (in order):
 *   renderExpensePage / renderExpenseTable / openExpenseModal   (Expense)
 *   aSvg / aPolar + module state (summaryMonth, acctView, acctYear,
 *     acctMonth, acctVatMode, acctTableMonth, expMonthKey)
 *   renderSummaryPage / renderSummaryData / renderCostDonuts /
 *     renderSummaryDonut                                         (Cost Summary)
 *   acctEntries / acctYears / acctVatOf / acctIsVatable /
 *     acctSum / acctDate                                         (shared maths)
 *   renderAccountPage / renderAccountSummary / renderAcctBars /
 *     renderAccountTable                                         (Monthly Report)
 *   renderDeletedPage                                            (Deleted List)
 *   renderVatPage                                                (VAT Calculation)
 *
 * STILL LIVE in store-core.js (do not re-add): expenses[] + saveExpenses,
 * computeRow, generateExpenseId, nextSeq, productTagName, postStockExpense,
 * the deleted-record bins (deletedOrders / deletedProducts + toBin), the
 * locked "Product" expense tag, isPaidOrder, orderCOGS / orderProfit.
 * The ledger view (renderRevenuePage in _ledgerMode) was removed too — see
 * ledger-view.js in this folder.
 * ==========================================================================*/

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
