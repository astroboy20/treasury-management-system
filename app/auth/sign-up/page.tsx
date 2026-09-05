'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { ArrowLeft, UserRound } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { signUp } from '@/lib/supabase/client'

const roles = [
  { value: 'ACCOUNT_OFFICER',  label: 'Account Officer' },
  { value: 'TREASURY_OFFICER', label: 'Treasury Officer' },
  { value: 'MIS',              label: 'MIS Officer' },
  { value: 'AUDIT',            label: 'Audit Officer' },
  { value: 'OPERATIONS',       label: 'Operations Officer' },
  { value: 'HEAD_TREASURY',    label: 'Head of Treasury' },
  { value: 'MD',               label: 'Managing Director' },
]

export default function SignUpPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('ACCOUNT_OFFICER')
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    setIsError(false)

    const { error: signupError } = await signUp(email.trim(), password, name.trim(), role)

    if (signupError) {
      setIsError(true)
      setMessage(
        signupError.message.toLowerCase().includes('already')
          ? 'An account with this email already exists.'
          : 'We could not create your account. Check your details and try again.'
      )
    } else {
      setMessage(
        'Account created. Check your email to confirm access, then sign in. ' +
        'Your role will be activated by an administrator.'
      )
    }

    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <Link
            href="/auth/login"
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to sign in
          </Link>

          <div className="mb-8">
            <div className="mb-4 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
              <UserRound className="size-6" />
            </div>
            <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Request workspace access
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Create an account for your assigned First Marina Trust role.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <label className="block text-sm font-medium">
              Full name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none transition-shadow focus:ring-3 focus:ring-ring/30"
                placeholder="Your name"
              />
            </label>

            <label className="block text-sm font-medium">
              Work email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none transition-shadow focus:ring-3 focus:ring-ring/30"
                placeholder="you@company.com"
              />
            </label>

            <label className="block text-sm font-medium">
              Workspace role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none transition-shadow focus:ring-3 focus:ring-ring/30"
              >
                {roles.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="mt-2 block text-xs font-normal text-muted-foreground">
                Your role controls which workflow actions you can access.
              </span>
            </label>

            <label className="block text-sm font-medium">
              Password
              <input
                required
                minLength={8}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none transition-shadow focus:ring-3 focus:ring-ring/30"
                placeholder="Min 8 characters"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="h-12 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground transition-[transform,background-color] duration-150 ease-out hover:bg-primary-hover active:scale-[.97] disabled:opacity-60"
            >
              {loading ? 'Creating…' : 'Create account'}
            </button>
          </form>

          {message && (
            <Alert
              variant={isError ? 'destructive' : 'default'}
              className="mt-6"
            >
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have access?{' '}
            <Link href="/auth/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
