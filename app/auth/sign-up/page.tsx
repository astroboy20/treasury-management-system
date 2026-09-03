'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { ArrowLeft, UserRound } from 'lucide-react'
import { signUp } from '@/lib/supabase/client'

export default function SignUpPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    setError(false)
    const { error: signupError } = await signUp(email.trim(), password, name.trim())
    if (signupError) {
      setError(true)
      setMessage('We could not create your account. Check your details and try again.')
    } else {
      setMessage('Account created. Check your email to confirm access.')
    }
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-md">
          <Link href="/auth/login" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to sign in</Link>
          <div className="mb-8"><div className="mb-4 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary"><UserRound className="size-6" /></div><h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Request workspace access</h1><p className="mt-3 text-sm text-muted-foreground">Create an account for your assigned Greenline role.</p></div>
          <form onSubmit={submit} className="space-y-5">
            <label className="block text-sm font-medium">Full name<input required value={name} onChange={(e) => setName(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none focus:ring-3 focus:ring-ring/30" placeholder="Your name" /></label>
            <label className="block text-sm font-medium">Work email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none focus:ring-3 focus:ring-ring/30" placeholder="you@company.com" /></label>
            <label className="block text-sm font-medium">Password<input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none focus:ring-3 focus:ring-ring/30" placeholder="Min 8 characters" /></label>
            <button type="submit" disabled={loading} className="h-12 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground transition-transform duration-150 ease-out hover:bg-primary-hover disabled:opacity-60 active:scale-[.97]">{loading ? 'Creating...' : 'Create account'}</button>
          </form>
          {message && <div className={`mt-6 rounded-lg p-4 text-sm ${error ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>{message}</div>}
        </div>
      </div>
    </main>
  )
}
