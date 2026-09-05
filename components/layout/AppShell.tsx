'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  Bell,
  ChevronDown,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  X,
  Cog,
} from 'lucide-react'
import { signOut } from '@/lib/supabase/client'
import type { Profile } from '@/lib/services/auth.service'

interface AppShellProps {
  user: { id: string; email: string }
  profile: Profile | null
  role: string
  children: React.ReactNode
}

// Nav items visible to all staff roles
const baseNavItems = [
  { label: 'Overview',     href: '/dashboard',     icon: LayoutDashboard },
  { label: 'Transactions', href: '/transactions',   icon: FileText },
  { label: 'Approvals',    href: '/approvals',      icon: ClipboardCheck },
  { label: 'Vouchers',     href: '/vouchers',       icon: FileText },
  { label: 'Audit trail',  href: '/audit',          icon: ShieldCheck },
]

// Role-specific nav additions
const roleNavItems: Record<string, { label: string; href: string; icon: React.ElementType }[]> = {
  OPERATIONS: [
    { label: 'Operations', href: '/operations', icon: Cog },
  ],
  ADMIN: [
    { label: 'Admin',      href: '/admin',      icon: Settings },
  ],
}

// Role display labels
const ROLE_LABELS: Record<string, string> = {
  TREASURY_OFFICER: 'Treasury Officer',
  ACCOUNT_OFFICER:  'Account Officer',
  HEAD_TREASURY:    'Head of Treasury',
  MIS:              'MIS Officer',
  AUDIT:            'Audit Officer',
  MD:               'Managing Director',
  OPERATIONS:       'Operations Officer',
  ADMIN:            'Administrator',
}

// Get initials from a full name
function getInitials(name: string | null | undefined): string {
  if (!name) return 'U'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export default function AppShell({ user, profile, role, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  const navItems = [
    ...baseNavItems,
    ...(roleNavItems[role] ?? []),
  ]

  const displayName = profile?.full_name ?? user.email
  const initials = getInitials(profile?.full_name)
  const roleLabel = ROLE_LABELS[role] ?? role

  return (
    <main className="min-h-screen bg-muted/30 text-foreground">
      {/* ── Sidebar ── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-20 w-64 border-r border-border bg-background p-5
          transition-transform duration-200
          [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]
          lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo */}
        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-3 font-semibold">
            <span className="grid size-9 place-items-center rounded-xl bg-primary font-mono text-sm text-primary-foreground">
              FMT
            </span>
            First Marina Trust<span className="text-primary">.</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground active:scale-[.97]"
            aria-label="Close navigation"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="mt-10 space-y-1 text-sm">
          {navItems.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors
                  @media (hover: hover) and (pointer: fine) { hover:bg-muted hover:text-foreground }
                  ${isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }
                `}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* User / Sign out */}
        <div className="absolute bottom-5 left-5 right-5 border-t border-border pt-4">
          <div className="mb-3 flex items-center gap-3 px-3 py-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-semibold text-primary">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{roleLabel}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="
              flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground
              transition-colors hover:bg-muted hover:text-foreground active:scale-[.97]
            "
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Sidebar backdrop (mobile) */}
      {sidebarOpen && (
        <button
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-10 bg-foreground/20 lg:hidden"
        />
      )}

      {/* ── Main content ── */}
      <section className="lg:pl-64">
        {/* Top header */}
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-background/95 px-5 backdrop-blur-sm sm:px-8">
          {/* Mobile menu button */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground active:scale-[.97]"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>

          {/* Desktop page context (left) — empty slot for page-level header */}
          <div className="hidden lg:block" />

          {/* Right: notifications + profile */}
          <div className="flex items-center gap-4">
            {/* Notification bell — wired to Realtime in Phase 7 */}
            <button className="relative text-muted-foreground transition-colors hover:text-foreground active:scale-[.97]">
              <Bell className="size-5" />
              {/* Badge placeholder — populated in Phase 7 */}
            </button>

            {/* Profile pill */}
            <div className="flex items-center gap-3 border-l border-border pl-4">
              <span className="grid size-9 place-items-center rounded-full bg-emerald-100 text-xs font-semibold text-primary">
                {initials}
              </span>
              <div className="hidden sm:block">
                <p className="text-sm font-medium">{displayName}</p>
                <p className="text-xs text-muted-foreground">{roleLabel}</p>
              </div>
              <ChevronDown className="hidden size-4 text-muted-foreground sm:block" />
            </div>
          </div>
        </header>

        {/* Page content */}
        <div>{children}</div>
      </section>
    </main>
  )
}
