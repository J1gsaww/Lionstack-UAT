# Accounting archive

Everything in this folder was **removed from the running app** so the Accounting
section can be rebuilt from a clean slate. Nothing here is loaded by
`index.html` — these are reference copies only.

| File | What it holds |
|---|---|
| `store-core.full-backup.js` | The **entire** `js/modules/store-core.js` exactly as it was before the removal. The safest reference: if something was missed, it's in here. |
| `accounting-subpages.js` | The extracted subpages: Expense, Cost Summary (incl. both cost donuts + the SVG donut renderer), Monthly Report (summary + bars + table), Deleted List, VAT Calculation, plus the shared `acct*` helpers and their module state. |
| `ledger-view.js` | The Ledger view — it was not its own page, it was a `_ledgerMode` flag that re-skinned the Revenue/Billing table. Explains exactly how it hooked in. |
| `acct-config.js` | The Accounting "Setting" subpage (expense-tag editor). |

## What is still LIVE in store-core.js

These were deliberately **kept**, because things outside Accounting depend on
them — do not re-add them from the archive:

- `expenses[]` + `saveExpenses()` — restock still records expenses
- `computeRow()`, `generateExpenseId()`, `nextSeq()` — running numbers keep counting
- `productTagName()` + `postStockExpense()` — auto-expense on restock / opening stock
- the locked **Product** expense tag (created in `migrateConfigRoles`)
- `deletedOrders` / `deletedProducts` + `toBin()` — deleting a bill or product
  still parks it (with its cost lots and auto-expenses) instead of destroying it.
  **There is currently no UI to view or restore them** — that was the Deleted List.
- `isPaidOrder()` / `paidStatusName()`
- `orderCOGS()` / `orderProfit()` — profit maths, ready for the rebuild
- order fields still being written: `o.vatable`, `o.verified`, `o.verifiedBy`

## CSS left in place

`.led-table`, `.led-sticky-vat`, `.led-sticky-ver`, `.led-verify*`,
`.art-profit`, `.art-vat-*`, `.art-sum-split`, `.art-sum-half`, `.eh-*` …
are still in `css/styles.css`. Harmless, and handy if the rebuild reuses them.

## The Accounting page today

The `accounting` module is still registered but with **no subpages**, so it
renders an empty placeholder. It is kept registered on purpose: it carries
`dataTools`, which is what puts the store's Import/Export box on the
Settings → Import/Export page.
