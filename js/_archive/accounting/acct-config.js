/* ============================================================================
 * ARCHIVED — the Accounting "Setting" subpage (expense tags editor).
 * NOT LOADED. Reference only.
 * Note: config.expenseTags itself is STILL LIVE (the locked "Product" tag is
 * created by migrateConfigRoles in store-core.js and used by postStockExpense).
 * ==========================================================================*/

  function renderAcctConfig(body){
    const rerender = ()=> renderAcctConfig(body);
    body.innerHTML = renderConfigShell(
      groupHtml('expenseTags', T('set.expenseTags')) + broughtFromHtml() + prefixHtml());
    const host = body.querySelector('#artSetGroups');
    wireGroups(host, body, rerender);
    wireBroughtFrom(host, body, rerender);
    wirePrefix(host);
  }
