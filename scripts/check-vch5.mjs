const URL = 'https://ewahupqerzovaoycaoai.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3YWh1cHFlcnpvdmFveWNhb2FpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODU2ODA3OSwiZXhwIjoyMTA0MTQ0MDc5fQ.6Op27R-EOkQkRIXFsQMGZGAuI2_tEupb1NpCgF26_Ds';
const h = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const r = await fetch(`${URL}/rest/v1/vouchers?select=voucher_number,calculation_snapshot&voucher_number=eq.VCH-00005`, { headers: h });
const rows = await r.json();
console.log(JSON.stringify(rows[0].calculation_snapshot, null, 2));
