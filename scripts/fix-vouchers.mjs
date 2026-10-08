// Fix existing vouchers with null principal/interest/net_amount by pulling
// data from their linked investment_verifications records.

const URL = 'https://ewahupqerzovaoycaoai.supabase.co'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3YWh1cHFlcnpvdmFveWNhb2FpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODU2ODA3OSwiZXhwIjoyMTA0MTQ0MDc5fQ.6Op27R-EOkQkRIXFsQMGZGAuI2_tEupb1NpCgF26_Ds'

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function get(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: HEADERS })
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`)
  return r.json()
}

async function patch(path, body) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`PATCH ${path} → ${r.status} ${await r.text()}`)
  return r.json()
}

async function main() {
  // 1. Get all vouchers that have null principal (broken ones)
  const vouchers = await get('vouchers?select=id,voucher_number,voucher_type,transaction_id&principal=is.null&order=created_at.asc')
  console.log(`Found ${vouchers.length} vouchers with null principal`)

  for (const v of vouchers) {
    console.log(`\nProcessing ${v.voucher_number} (${v.voucher_type}) tx=${v.transaction_id}`)

    // 2. Get the transaction details
    const txRows = await get(`treasury_transactions?select=transaction_type,scenario_code,requested_amount&id=eq.${v.transaction_id}`)
    if (!txRows.length) { console.log('  SKIP: no transaction'); continue }
    const tx = txRows[0]

    // 3. Get investment verification
    const invRows = await get(`investment_verifications?select=principal,accrued_interest,interest_rate,effective_date,maturity_date,available_amount&transaction_id=eq.${v.transaction_id}`)

    if (v.voucher_type === 'ROLLOVER_SLIP') {
      if (!invRows.length) { console.log('  SKIP: no investment verification'); continue }
      const inv = invRows[0]
      const principal = parseFloat(inv.principal)
      const accruedInterest = parseFloat(inv.accrued_interest)
      const interestRate = String(inv.interest_rate)
      const effectiveDate = inv.effective_date
      const maturityDate = inv.maturity_date ?? ''
      const scenarioCode = tx.scenario_code ?? 'P_AND_I'

      // Calculate rollover amount based on scenario
      let rolloverAmount, rule
      if (scenarioCode === 'PRINCIPAL_ONLY') {
        rolloverAmount = principal
        rule = 'ROLLOVER_PRINCIPAL_ONLY'
      } else if (scenarioCode === 'INTEREST_ONLY') {
        rolloverAmount = principal
        rule = 'ROLLOVER_INTEREST_ONLY'
      } else {
        // P_AND_I default
        rolloverAmount = Math.round((principal + accruedInterest) * 10000) / 10000
        rule = 'ROLLOVER_P_AND_I'
      }

      const snapshot = {
        rule,
        inputs: {
          rollover_type: scenarioCode,
          principal: String(principal),
          interest_due: String(accruedInterest),
          interest_rate: interestRate,
          effective_date: effectiveDate,
          maturity_date: maturityDate,
          new_rate: interestRate,
          new_tenor: '90',
          rollover_maturity_date: '',
        },
        outputs: {
          rollover_amount: String(rolloverAmount),
        },
        calculated_at: new Date().toISOString(),
      }

      const updated = await patch(`vouchers?id=eq.${v.id}`, {
        principal,
        interest: accruedInterest,
        net_amount: rolloverAmount,
        calculation_snapshot: snapshot,
      })

      const row = Array.isArray(updated) ? updated[0] : updated
      console.log(`  ✓ principal=${row.principal} interest=${row.interest} net_amount=${row.net_amount}`)
    }

    else if (v.voucher_type === 'TRANSFER_SLIP') {
      const amount = parseFloat(tx.requested_amount ?? '0')
      const snapshot = {
        rule: 'INTERNAL_TRANSFER_NO_CHARGE',
        inputs: { transfer_amount: String(amount), is_internal: 'true' },
        outputs: { transfer_charge: '0', net_amount: String(amount) },
        calculated_at: new Date().toISOString(),
      }

      const updated = await patch(`vouchers?id=eq.${v.id}`, {
        net_amount: amount,
        calculation_snapshot: snapshot,
      })

      const row = Array.isArray(updated) ? updated[0] : updated
      console.log(`  ✓ net_amount=${row.net_amount}`)
    }

    else if (v.voucher_type === 'FUNDS_OUT') {
      if (!invRows.length) { console.log('  SKIP: no investment verification'); continue }
      const inv = invRows[0]
      const principal = parseFloat(inv.principal)
      const accruedInterest = parseFloat(inv.accrued_interest)
      const charge = Math.round(accruedInterest * 0.20 * 10000) / 10000
      const netInterest = Math.round((accruedInterest - charge) * 10000) / 10000
      const netAmount = Math.round((principal + netInterest) * 10000) / 10000

      const snapshot = {
        rule: 'PRE_LIQUIDATION_20_PERCENT',
        inputs: { accrued_interest: String(accruedInterest), charge_rate: '0.2' },
        outputs: { charge: String(charge), net_interest: String(netInterest) },
        calculated_at: new Date().toISOString(),
      }

      const updated = await patch(`vouchers?id=eq.${v.id}`, {
        principal,
        interest: accruedInterest,
        charge,
        net_amount: netAmount,
        calculation_snapshot: snapshot,
      })

      const row = Array.isArray(updated) ? updated[0] : updated
      console.log(`  ✓ principal=${row.principal} net_amount=${row.net_amount}`)
    }

    else if (v.voucher_type === 'FUNDS_IN') {
      const amount = parseFloat(tx.requested_amount ?? '0')
      const snapshot = {
        rule: 'FUNDS_IN',
        inputs: { amount: String(amount) },
        outputs: { net_amount: String(amount) },
        calculated_at: new Date().toISOString(),
      }

      const updated = await patch(`vouchers?id=eq.${v.id}`, {
        net_amount: amount,
        calculation_snapshot: snapshot,
      })

      const row = Array.isArray(updated) ? updated[0] : updated
      console.log(`  ✓ net_amount=${row.net_amount}`)
    }

    else {
      console.log(`  SKIP: unhandled type ${v.voucher_type}`)
    }
  }

  console.log('\nDone. Verifying...')
  const check = await get('vouchers?select=voucher_number,voucher_type,principal,interest,net_amount&order=created_at.asc')
  for (const c of check) {
    console.log(`${c.voucher_number} ${c.voucher_type}: principal=${c.principal} interest=${c.interest} net=${c.net_amount}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
