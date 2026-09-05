'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Lock } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { StepMeta } from '@/lib/services/workflow.service'

// ─── Props ────────────────────────────────────────────────────────────────────

interface StepProgressTrackerProps {
  /** The current workflow status string — used for accessibility labelling. */
  currentStatus: string
  steps: StepMeta[]
}

// ─── Reduced-motion detection ─────────────────────────────────────────────────

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return reduced
}

// ─── Step icon ────────────────────────────────────────────────────────────────

function StepIcon({ state, id }: { state: StepMeta['state']; id: number }) {
  if (state === 'completed') {
    return (
      <span
        className="flex size-7 items-center justify-center rounded-full bg-emerald-500 text-white"
        aria-hidden
      >
        <Check className="size-3.5 stroke-[2.5]" />
      </span>
    )
  }

  if (state === 'active') {
    return (
      <span
        className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold"
        aria-hidden
      >
        {/* Active indicator — filled circle (●) */}
        <span className="sr-only">Step {id} active</span>
        <span aria-hidden className="size-2 rounded-full bg-primary-foreground" />
      </span>
    )
  }

  // locked
  return (
    <span
      className="flex size-7 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground"
      aria-hidden
    >
      <Lock className="size-3" />
    </span>
  )
}

// ─── Connector line ───────────────────────────────────────────────────────────

function Connector({ completed }: { completed: boolean }) {
  return (
    <div
      className={[
        'hidden h-0.5 flex-1 transition-colors duration-300 sm:block',
        completed ? 'bg-emerald-400' : 'bg-border',
      ].join(' ')}
      aria-hidden
    />
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StepProgressTracker({
  currentStatus,
  steps,
}: StepProgressTrackerProps) {
  const [mounted, setMounted] = useState(false)
  const reducedMotion = usePrefersReducedMotion()
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      // Small delay so initial styles are painted before transition begins
      const t = setTimeout(() => setMounted(true), 20)
      return () => clearTimeout(t)
    }
  }, [])

  return (
    <TooltipProvider>
      <nav
        aria-label={`Transaction workflow steps — current status: ${currentStatus}`}
        className="border-b border-border bg-background px-5 py-4 sm:px-8"
      >
        <ol className="flex items-center gap-0 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1
            const delayMs = index * 40

            /*
             * prefers-reduced-motion:
             *   - Skip the scale/transform entirely
             *   - Keep the opacity fade (less vestibular impact)
             *
             * Full motion:
             *   - opacity 0→1 + scale(0.95)→scale(1), 200ms ease-out
             */
            const itemStyle: React.CSSProperties = reducedMotion
              ? {
                  opacity: mounted ? 1 : 0,
                  transition: `opacity 200ms ease-out ${delayMs}ms`,
                }
              : {
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'scale(1)' : 'scale(0.95)',
                  transition: `opacity 200ms ease-out ${delayMs}ms, transform 200ms ease-out ${delayMs}ms`,
                }

            return (
              <li key={step.id} className="flex min-w-0 flex-1 items-center">
                {/* Step item */}
                <div
                  className="flex min-w-[5.5rem] flex-col items-center gap-1.5 px-1"
                  style={itemStyle}
                >
                  {/* Icon — wrapped in Tooltip when locked with a reason */}
                  {step.state === 'locked' && step.lockedReason ? (
                    <Tooltip>
                      <TooltipTrigger>
                        {/* Focusable span for keyboard-accessible tooltip */}
                        <button
                          type="button"
                          aria-label={`Step ${step.id} locked: ${step.lockedReason}`}
                          className="cursor-default"
                          tabIndex={0}
                        >
                          <StepIcon state={step.state} id={step.id} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={6}>
                        {step.lockedReason}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <StepIcon state={step.state} id={step.id} />
                  )}

                  {/* Label + sub-label */}
                  <div className="text-center">
                    <p
                      className={[
                        'text-xs font-medium',
                        step.state === 'completed'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : step.state === 'active'
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                      ].join(' ')}
                    >
                      {step.label}
                    </p>
                    <p className="hidden text-[0.65rem] text-muted-foreground sm:block">
                      {step.state === 'completed'
                        ? 'Done'
                        : step.state === 'active'
                        ? 'In progress'
                        : 'Pending'}
                    </p>
                  </div>
                </div>

                {/* Connector line between steps */}
                {!isLast && <Connector completed={step.state === 'completed'} />}
              </li>
            )
          })}
        </ol>
      </nav>
    </TooltipProvider>
  )
}
