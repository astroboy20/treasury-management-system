const URL = 'https://ewahupqerzovaoycaoai.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3YWh1cHFlcnpvdmFveWNhb2FpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODU2ODA3OSwiZXhwIjoyMTA0MTQ0MDc5fQ.6Op27R-EOkQkRIXFsQMGZGAuI2_tEupb1NpCgF26_Ds';
const h = { apikey: KEY, Authorization: 'Bearer ' + KEY };

const r = await fetch(URL + '/rest/v1/vouchers?select=voucher_number,voucher_type,principal,interest,net_amount,calculation_snapshot&order=created_at.asc', { headers: h });
const rows = await r.json();

let allGood = true;
for (const row of rows) {
  const snap = row.calculation_snapshot || {};
  const rule = snap.rule || '(empty)';
  const inputKeys = Object.keys(snap.inputs || {});
  const outputKeys = Object.keys(snap.outputs || {});
  const hasSnap = !!snap.rule;

  console.log(`\n${row.voucher_number} [${row.voucher_type}]`);
  console.log(`  principal=${row.principal}  interest=${row.interest}  net_amount=${row.net_amount}`);
  console.log(`  snapshot.rule = ${rule}`);
  console.log(`  snapshot.inputs  = [${inputKeys.join(', ')}]`);
  console.log(`  snapshot.outputs = [${outputKeys.join(', ')}]`);

  // Check for issues
  if (row.voucher_type === 'ROLLOVER_SLIP') {
    if (!row.principal) { console.log('  ⚠ principal is null'); allGood = false; }
    if (!row.interest) { console.log('  ⚠ interest is null'); allGood = false; }
    if (!row.net_amount) { console.log('  ⚠ net_amount is null'); allGood = false; }
    if (!hasSnap) { console.log('  ⚠ calculation_snapshot is empty'); allGood = false; }
    if (!snap.inputs?.principal) { console.log('  ⚠ snapshot.inputs.principal missing'); allGood = false; }
    if (!snap.outputs?.rollover_amount) { console.log('  ⚠ snapshot.outputs.rollover_amount missing'); allGood = false; }
  }
  if (row.voucher_type === 'TRANSFER_SLIP') {
    if (!row.net_amount) { console.log('  ⚠ net_amount is null'); allGood = false; }
  }
}

console.log(`\n${allGood ? '✅ All vouchers look correct' : '❌ Some issues found'}`);
