/**
 * POST /api/twilio/outbound-voice
 *
 * TwiML webhook called by Twilio when the Voice SDK initiates an outbound call.
 * Returns TwiML instructing Twilio to dial the phone number passed as `To`.
 *
 * Twilio TwiML App Voice Request URL must point to this endpoint.
 * Set the caller ID in TWILIO_CALLER_ID (a verified Twilio number or verified caller ID).
 */

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.formData()
  const to = body.get('To') as string | null

  const callerId = process.env.TWILIO_CALLER_ID ?? process.env.TWILIO_ACCOUNT_SID ?? ''

  if (!to) {
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>No phone number provided.</Say></Response>`,
      { status: 400, headers: { 'Content-Type': 'text/xml' } },
    )
  }

  // Sanitise: only allow E.164 format to prevent SSRF/call hijacking
  const e164Regex = /^\+?[1-9]\d{6,14}$/
  if (!e164Regex.test(to.replace(/\s/g, ''))) {
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>Invalid phone number format.</Say></Response>`,
      { status: 400, headers: { 'Content-Type': 'text/xml' } },
    )
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" timeout="30" record="do-not-record">
    <Number>${to}</Number>
  </Dial>
</Response>`

  return new NextResponse(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
