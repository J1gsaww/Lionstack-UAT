/* ============================================================================
 * ARCHIVED LEDGER VIEW — the Accounting copy of the Revenue/Billing table.
 * NOT LOADED. Reference only.
 *
 * It worked by setting a module-level flag `_ledgerMode = (subpage === 'ledger')`
 * at the top of renderSubpage, then branching inside renderRevenuePage /
 * renderOrdersTable to: hide the + Add button, render tag + both statuses as
 * read-only pills, drop the edit/delete buttons (keeping the document button),
 * filter to paid invoices only (isPaidOrder — still live in store-core), and
 * append four extra columns: COGS, Profit, a VAT tick (o.vatable) and a
 * Verified pill (o.verified/o.verifiedBy), the last two pinned sticky-right
 * with .led-sticky-vat / .led-sticky-ver / .led-table CSS (still in styles.css).
 * ==========================================================================*/

  function ledgerVerifyPill(o){
    const on = !!o.verified;
    const can = (typeof window.roleCanAccess !== 'function') || window.roleCanAccess(window.currentRole, 'verifyLedger');
    return `<span class="art-pill led-verify ${can?'led-verify-btn':''}" style="background:${on?'#6B8F71':'#C6432E'};">${esc(on?T('sh.verYes'):T('sh.verNo'))}</span>${(on && o.verifiedBy) ? ` <span class="sh-verify-by">${esc(o.verifiedBy)}</span>` : ''}`;
  }

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

