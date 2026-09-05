import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ShieldCheck,
  Workflow,
  FileCheck2,
} from "lucide-react";

const features = [
  {
    icon: Workflow,
    title: "Workflow control",
    text: "Move every instruction through one visible, accountable operating path.",
  },
  {
    icon: ShieldCheck,
    title: "Role-based approvals",
    text: "Give each reviewer the context and authority they need, never more.",
  },
  {
    icon: FileCheck2,
    title: "Audit-ready by default",
    text: "Keep decisions, calculations and execution evidence together.",
  },
];

export default function Page() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <span className="font-mono text-sm font-bold">FMT</span>
          </span>
          <span className="font-semibold tracking-tight">
            First Marina Trust<span className="text-primary">.</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a
            href="#platform"
            className="transition-colors hover:text-foreground"
          >
            Platform
          </a>
          <a
            href="#controls"
            className="transition-colors hover:text-foreground"
          >
            Controls
          </a>
          <a href="#access" className="transition-colors hover:text-foreground">
            Access
          </a>
        </nav>
        <Link
          href="/auth/login"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform duration-150 ease-out hover:bg-primary-hover active:scale-[.97]"
        >
          Sign in <ArrowUpRight className="size-4" />
        </Link>
      </header>
      <section className="mx-auto grid max-w-7xl gap-16 px-6 pb-24 pt-16 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:px-10 lg:pb-32 lg:pt-24">
        <div>
          <p className="mb-6 flex items-center gap-2 text-sm font-medium text-primary">
            <span className="size-2 rounded-full bg-primary" /> Treasury
            operations, brought into focus
          </p>
          <h1 className="max-w-3xl text-balance text-5xl font-semibold tracking-[-.055em] text-foreground sm:text-6xl lg:text-7xl">
            Move money with <span className="text-primary">certainty.</span>
          </h1>
          <p className="mt-7 max-w-xl text-pretty text-lg leading-8 text-muted-foreground">
            First Marina Trust gives treasury teams a calm, controlled workspace
            for instructions, verification, approvals and execution.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/auth/login"
              className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-transform duration-150 ease-out hover:bg-primary-hover active:scale-[.97]"
            >
              Open workspace <ArrowUpRight className="size-4" />
            </Link>
            <a
              href="#platform"
              className="inline-flex h-12 items-center rounded-lg border border-border px-5 text-sm font-medium transition-colors hover:bg-muted"
            >
              Explore platform
            </a>
          </div>
          <div className="mt-10 flex items-center gap-5 text-sm text-muted-foreground">
            <div className="flex -space-x-2">
              <span className="grid size-8 place-items-center rounded-full border-2 border-background bg-emerald-100 text-xs font-semibold text-primary">
                AO
              </span>
              <span className="grid size-8 place-items-center rounded-full border-2 border-background bg-slate-100 text-xs font-semibold text-slate-700">
                HT
              </span>
              <span className="grid size-8 place-items-center rounded-full border-2 border-background bg-amber-100 text-xs font-semibold text-amber-800">
                MD
              </span>
            </div>
            <span>Built for teams where every decision matters.</span>
          </div>
        </div>
        <div className="relative">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_80px_-32px_rgba(2,59,30,.35)]">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="text-xs text-muted-foreground">Today, 09:42</p>
                <p className="mt-1 font-semibold">Treasury overview</p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                Live workspace
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5">
              <div className="rounded-xl bg-muted p-4">
                <p className="text-xs text-muted-foreground">
                  Pending my action
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-tight">08</p>
                <p className="mt-2 text-xs text-amber-700">
                  ↑ 2 since yesterday
                </p>
              </div>
              <div className="rounded-xl bg-primary p-4 text-primary-foreground">
                <p className="text-xs text-primary-foreground/70">
                  Completed this week
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-tight">
                  ₦48.2m
                </p>
                <p className="mt-2 text-xs text-primary-foreground/70">
                  Across 23 instructions
                </p>
              </div>
            </div>
            <div className="px-5 pb-5">
              <div className="flex items-center justify-between border-b border-border pb-3 text-xs font-medium text-muted-foreground">
                <span>Recent instructions</span>
                <span>Current owner</span>
              </div>
              {[
                ["TRX-02481", "Full rollover", "Head Treasury"],
                ["TRX-02476", "Third-party payment", "Operations"],
                ["TRX-02463", "Pre-liquidation", "Account Officer"],
              ].map(([ref, type, owner]) => (
                <div
                  key={ref}
                  className="flex items-center justify-between border-b border-border py-4 last:border-0"
                >
                  <div>
                    <p className="font-mono text-xs text-primary">{ref}</p>
                    <p className="mt-1 text-sm font-medium">{type}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{owner}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="absolute -bottom-6 -left-6 hidden rounded-xl border border-border bg-background p-4 shadow-lg sm:block">
            <p className="flex items-center gap-2 text-xs font-medium text-primary">
              <Check className="size-4" /> All controls satisfied
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Audit trail is up to date
            </p>
          </div>
        </div>
      </section>
      <section id="platform" className="border-y border-border bg-muted/40">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="max-w-xl">
            <p className="text-sm font-medium text-primary">
              One operating rhythm
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Clarity at every handoff.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              A shared source of truth for the people who initiate, review,
              approve and execute treasury work.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => (
              <article
                key={title}
                className="rounded-xl border border-border bg-background p-6 transition-transform duration-200 ease-out hover:-translate-y-1"
              >
                <Icon className="size-5 text-primary" />
                <h3 className="mt-8 font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {text}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section id="controls" className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-medium text-primary">
              Designed for confidence
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              No more invisible work.
            </h2>
            <p className="mt-4 max-w-lg leading-7 text-muted-foreground">
              First Marina Trust makes status, ownership and evidence explicit,
              so your team can focus on sound decisions rather than chasing
              updates.
            </p>
          </div>
          <div className="grid gap-3">
            {[
              "Six-step workflow from instruction to completion",
              "Calculation snapshots for reproducible outcomes",
              "Immutable audit events for every key decision",
            ].map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 rounded-lg border border-border p-4 text-sm"
              >
                <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-primary">
                  <Check className="size-3.5" />
                </span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>
      <footer id="access" className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <span>© 2026 First Marina Trust Treasury</span>
          <span>Controlled operations for modern finance teams.</span>
        </div>
      </footer>
    </main>
  );
}
