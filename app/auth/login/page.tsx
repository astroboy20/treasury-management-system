'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { ArrowLeft, ArrowUpRight, LockKeyhole } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { signIn } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: authError } = await signIn(email, password)

    if (authError) {
      const message = authError.message.toLowerCase()
      const code = (authError as { code?: string }).code
      if (message.includes('email not confirmed')) {
        setError(
          'Please confirm your email address before signing in. Check your inbox for the confirmation link.'
        )
      } else if (
        code === 'invalid_credentials' ||
        message.includes('invalid login credentials') ||
        message.includes('invalid email or password')
      ) {
        setError('Invalid email or password.')
      } else if (authError.status === 429 || message.includes('rate limit')) {
        setError('Too many attempts. Please wait a moment and try again.')
      } else {
        setError('We could not sign you in. Please try again.')
      }
    } else {
      window.location.href = '/dashboard'
    }

    setLoading(false)
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[.9fr_1.1fr]">
      {/* Left panel */}
      <section className="hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <Link href="/" className="flex items-center gap-3 font-semibold">
          <span className="grid size-9 place-items-center rounded-xl border border-primary-foreground/30 font-mono text-sm">
            FMT
          </span>
          First Marina Trust<span className="text-emerald-300">.</span>
        </Link>
        <div>
          <p className="mb-5 text-sm text-primary-foreground/60">Treasury operations workspace</p>
          <h1 className="max-w-md text-5xl font-semibold tracking-[-.05em]">
            Good decisions need a clear system.
          </h1>
          <p className="mt-6 max-w-md leading-7 text-primary-foreground/70">
            Sign in to continue managing controlled, auditable financial instructions.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/50">
          Secure access · Role-aware controls · Full audit history
        </p>
      </section>

      {/* Right panel */}
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="mb-14 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to home
          </Link>

          <div className="mb-8">
            <div className="mb-5 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <LockKeyhole className="size-5" />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight">Welcome back</h2>
            <p className="mt-2 text-muted-foreground">Sign in to your First Marina Trust workspace.</p>
            <p className="mt-3 text-sm text-muted-foreground">
              New to First Marina Trust?{' '}
              <Link href="/auth/sign-up" className="font-medium text-primary hover:underline">
                Create an account
              </Link>
            </p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <label className="block text-sm font-medium">
              Work email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 h-12 w-full rounded-lg border border-input bg-background px-3 outline-none transition-shadow focus:ring-3 focus:ring-ring/30"
                placeholder="you@company.com"
              />
            </label>

            <label className="block text-sm font-medium">
              Password
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 h-12 w-full rounded-lg border border-input bg-background px-3 outline-none transition-shadow focus:ring-3 focus:ring-ring/30"
                placeholder="Enter your password"
              />
            </label>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground transition-[transform,background-color] duration-150 ease-out hover:bg-primary-hover active:scale-[.97] disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign in'}
              <ArrowUpRight className="size-4" />
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Need access?{' '}
            <a href="mailto:access@firstmarinatrust.example" className="font-medium text-primary hover:underline">
              Contact your administrator
            </a>
          </p>
        </div>
      </section>
    </main>
  )
}
