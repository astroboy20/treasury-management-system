/**
 * POST /api/twilio/token
 *
 * Mints a short-lived Twilio Voice Access Token for the authenticated officer.
 * The token allows the Twilio Voice SDK in the browser to place outbound calls
 * through the Twilio TwiML App.
 *
 * Environment variables required (add to .env.local):
 *   TWILIO_ACCOUNT_SID   — from Twilio Console → Account Info
 *   TWILIO_AUTH_TOKEN    — from Twilio Console → Account Info
 *   TWILIO_API_KEY_SID   — from Twilio Console → API Keys (create a "Standard" key)
 *   TWILIO_API_KEY_SECRET— matching secret for the API key above
 *   TWILIO_TWIML_APP_SID — from Twilio Console → Voice → TwiML Apps (create one whose
 *                          Voice Request URL points to POST /api/twilio/outbound-voice)
 *
 * Security:
 *   - Route is protected by Supabase session check.
 *   - Tokens are valid for 60 minutes (3600 s).
 *   - Identity is set to the authenticated user's ID so calls are attributable.
 */

import { NextRequest, NextResponse } from 'next/server'
import * as Twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET,
  TWILIO_TWIML_APP_SID,
} = process.env

export async function POST(_req: NextRequest) {
  // ── Validate env ─────────────────────────────────────────────────────────
  if (
    !TWILIO_ACCOUNT_SID ||
    !TWILIO_API_KEY_SID ||
    !TWILIO_API_KEY_SECRET ||
    !TWILIO_TWIML_APP_SID
  ) {
    console.error('[twilio/token] Missing Twilio environment variables.')
    return NextResponse.json(
      { error: 'Calling service is not configured. Contact your administrator.' },
      { status: 503 },
    )
  }

  // ── Require authenticated session ────────────────────────────────────────
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // ── Mint token ───────────────────────────────────────────────────────────
  const AccessToken = Twilio.jwt.AccessToken
  const VoiceGrant = AccessToken.VoiceGrant

  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: TWILIO_TWIML_APP_SID,
    incomingAllow: false, // outbound-only for this use case
  })

  const token = new AccessToken(
    TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY_SID,
    TWILIO_API_KEY_SECRET,
    {
      identity: user.id,
      ttl: 3600, // 60-minute token
    },
  )
  token.addGrant(voiceGrant)

  return NextResponse.json({ token: token.toJwt() })
}
