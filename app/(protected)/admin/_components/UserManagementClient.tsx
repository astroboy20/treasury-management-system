'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  UserCheck,
  UserX,
  ShieldCheck,
  ShieldOff,
  ChevronDown,
  Loader2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import {
  assignRoleAction,
  revokeRoleAction,
  setUserActiveAction,
  type AdminUser,
  type RoleOption,
} from '@/lib/actions/admin.actions'
import { ROLE_LABELS } from '@/lib/permissions/permissions'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// ─── ConfirmDialog ────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  loading: boolean
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── UserManagementClient ─────────────────────────────────────────────────────

interface Props {
  initialUsers: AdminUser[]
  roles: RoleOption[]
  currentUserId: string
}

type PendingAction =
  | { type: 'assign'; user: AdminUser; role: RoleOption }
  | { type: 'revoke'; user: AdminUser; role: { id: string; code: string; name: string } }
  | { type: 'deactivate'; user: AdminUser }
  | { type: 'activate'; user: AdminUser }

export function UserManagementClient({ initialUsers, roles, currentUserId }: Props) {
  const [users, setUsers] = useState<AdminUser[]>(initialUsers)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [isPending, startTransition] = useTransition()

  // ── Derived helpers ────────────────────────────────────────────────────────

  /** Returns roles not yet assigned to the user */
  function availableRoles(user: AdminUser): RoleOption[] {
    const assigned = new Set(user.roles.map((r) => r.id))
    return roles.filter((r) => !assigned.has(r.id))
  }

  // ── Confirmation dispatch ──────────────────────────────────────────────────

  function confirmPending() {
    if (!pending) return

    startTransition(async () => {
      let result: { success: boolean; error?: string }

      if (pending.type === 'assign') {
        result = await assignRoleAction(pending.user.id, pending.role.id)
        if (result.success) {
          setUsers((prev) =>
            prev.map((u) =>
              u.id === pending.user.id
                ? { ...u, roles: [...u.roles, { id: pending.role.id, code: pending.role.code, name: pending.role.name }] }
                : u,
            ),
          )
          toast.success(`${pending.role.name} assigned to ${pending.user.full_name}.`)
        }
      } else if (pending.type === 'revoke') {
        result = await revokeRoleAction(pending.user.id, pending.role.id)
        if (result.success) {
          setUsers((prev) =>
            prev.map((u) =>
              u.id === pending.user.id
                ? { ...u, roles: u.roles.filter((r) => r.id !== pending.role.id) }
                : u,
            ),
          )
          toast.success(`${pending.role.name} revoked from ${pending.user.full_name}.`)
        }
      } else if (pending.type === 'deactivate') {
        result = await setUserActiveAction(pending.user.id, false)
        if (result.success) {
          setUsers((prev) =>
            prev.map((u) => (u.id === pending.user.id ? { ...u, is_active: false } : u)),
          )
          toast.success(`${pending.user.full_name} has been deactivated.`)
        }
      } else {
        // activate
        result = await setUserActiveAction(pending.user.id, true)
        if (result.success) {
          setUsers((prev) =>
            prev.map((u) => (u.id === pending.user.id ? { ...u, is_active: true } : u)),
          )
          toast.success(`${pending.user.full_name} has been reactivated.`)
        }
      }

      if (!result.success) {
        toast.error(result.error ?? 'Action failed. Please try again.')
      }

      setPending(null)
    })
  }

  // ── Dialog title / description helpers ────────────────────────────────────

  function getDialogProps(): { title: string; description: string; confirmLabel: string; destructive: boolean } {
    if (!pending) return { title: '', description: '', confirmLabel: 'Confirm', destructive: false }

    if (pending.type === 'assign') {
      return {
        title: `Assign ${pending.role.name}`,
        description: `This will grant ${pending.user.full_name} the ${pending.role.name} role. They will immediately gain the associated permissions.`,
        confirmLabel: 'Assign role',
        destructive: false,
      }
    }
    if (pending.type === 'revoke') {
      return {
        title: `Revoke ${pending.role.name}`,
        description: `This will remove the ${pending.role.name} role from ${pending.user.full_name}. Any in-progress actions requiring this role will be blocked.`,
        confirmLabel: 'Revoke role',
        destructive: true,
      }
    }
    if (pending.type === 'deactivate') {
      return {
        title: 'Deactivate user',
        description: `${pending.user.full_name} will no longer be able to sign in. Their historical records will be preserved.`,
        confirmLabel: 'Deactivate',
        destructive: true,
      }
    }
    return {
      title: 'Reactivate user',
      description: `${pending.user.full_name} will regain access to the platform with their existing roles.`,
      confirmLabel: 'Reactivate',
      destructive: false,
    }
  }

  const dialogProps = getDialogProps()

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="rounded-xl border border-border bg-background">
        {users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UserCheck className="mb-3 size-10 text-muted-foreground/40" aria-hidden />
            <p className="text-sm font-medium">No users found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Users will appear here once they sign up.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  User
                </TableHead>
                <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Roles
                </TableHead>
                <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Joined
                </TableHead>
                <TableHead className="px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const isSelf = user.id === currentUserId
                const available = availableRoles(user)

                return (
                  <TableRow
                    key={user.id}
                    className="border-t border-border transition-colors duration-150 hover:bg-muted/30"
                  >
                    {/* User */}
                    <TableCell className="px-5 py-4">
                      <p className="font-medium">
                        {user.full_name}
                        {isSelf && (
                          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            You
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{user.email}</p>
                    </TableCell>

                    {/* Roles */}
                    <TableCell className="px-5 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {user.roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No roles</span>
                        ) : (
                          user.roles.map((r) => (
                            <span
                              key={r.id}
                              className="group inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium"
                            >
                              {ROLE_LABELS[r.code] ?? r.name}
                              <button
                                aria-label={`Revoke ${r.name} from ${user.full_name}`}
                                title={`Revoke ${r.name}`}
                                className="ml-0.5 rounded-full text-muted-foreground opacity-50 transition-opacity hover:text-destructive hover:opacity-100"
                                onClick={() => setPending({ type: 'revoke', user, role: r })}
                              >
                                ×
                              </button>
                            </span>
                          ))
                        )}
                        {available.length > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label={`Assign role to ${user.full_name}`}
                              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary focus:outline-none"
                            >
                              + Assign
                              <ChevronDown className="size-3" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="min-w-44">
                              {available.map((r) => (
                                <DropdownMenuItem
                                  key={r.id}
                                  onSelect={() => setPending({ type: 'assign', user, role: r })}
                                >
                                  <ShieldCheck className="mr-2 size-4 text-primary" />
                                  {ROLE_LABELS[r.code] ?? r.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </TableCell>

                    {/* Status */}
                    <TableCell className="px-5 py-4">
                      {user.is_active ? (
                        <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-red-50 text-red-700 hover:bg-red-50">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>

                    {/* Joined */}
                    <TableCell className="px-5 py-4 text-sm text-muted-foreground">
                      {formatDate(user.created_at)}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="px-5 py-4">
                      {user.is_active ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isSelf}
                          title={isSelf ? 'You cannot deactivate your own account.' : `Deactivate ${user.full_name}`}
                          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive disabled:cursor-not-allowed"
                          onClick={() => setPending({ type: 'deactivate', user })}
                        >
                          <UserX className="size-3.5" />
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-primary"
                          onClick={() => setPending({ type: 'activate', user })}
                        >
                          <UserCheck className="size-3.5" />
                          Reactivate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Confirmation dialog */}
      <ConfirmDialog
        open={pending !== null}
        title={dialogProps.title}
        description={dialogProps.description}
        confirmLabel={dialogProps.confirmLabel}
        destructive={dialogProps.destructive}
        loading={isPending}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </>
  )
}
