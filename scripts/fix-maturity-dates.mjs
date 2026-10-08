// Patch rollover_maturity_date in existing voucher snapshots.
// Computed as effective_date + new_tenor days.

const URL = 'https://ewahupqerzovaoycaoai.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3YWh1cHFlcnpvdmFveWNhb2FpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODU2ODA3OSwiZXhwIjoyMTA0MTQ0MDc5fQ.6Op27R-EOkQkRIXFsQMGZGAuI2_tEupb1NpCgF26_Ds';
const h = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' };

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Get all ROLLOVER_SLIP vouchers with empty rollover_maturity_date in snapshot
const r = await fetch(`${URL}/rest/v1/vouchers?select=id,voucher_number,calculation_snapshot&voucher_type=eq.ROLLOVER_SLIP`, { headers: h });
const vouchers = await r.json();

for (const v of vouchers) {
  const snap = v.calculation_snapshot;
  if (!snap?.inputs) { console.log(`SKIP ${v.voucher_number}: no inputs`); continue; }

  const existing = snap.inputs.rollover_maturity_date;
  if (existing && existing !== '') { console.log(`SKIP ${v.voucher_number}: already has maturity date ${existing}`); continue; }

  const effectiveDate = snap.inputs.effective_date;
  const tenor = parseInt(snap.inputs.new_tenor ?? '90', 10);
  if (!effectiveDate) { console.log(`SKIP ${v.voucher_number}: no effective_date`); continue; }

  const maturityDate = addDays(effectiveDate, tenor);
  snap.inputs.rollover_maturity_date = maturityDate;

  const resp = await fetch(`${URL}/rest/v1/vouchers?id=eq.${v.id}`, {
    method: 'PATCH',
    headers: h,
    body: JSON.stringify({ calculation_snapshot: snap }),
  });
  const rows = await resp.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  console.log(`FIXED ${v.voucher_number}: rollover_maturity_date = ${maturityDate}`);
}

console.log('\nDone.');
