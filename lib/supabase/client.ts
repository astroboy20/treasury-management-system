import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

export async function signOut() {
  await createClient().auth.signOut()
  window.location.href = '/'
}

export async function signIn(email: string, password: string) {
  return createClient().auth.signInWithPassword({ email, password })
}

export async function signUp(email: string, password: string, fullName: string, roleCode: string) {
  return createClient().auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, requested_role: roleCode },
      emailRedirectTo:
        process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ??
        `${window.location.origin}/auth/callback`,
    },
  })
}
