import type { ReactNode } from 'react'
import { Link } from 'react-router'

interface AuthPageShellProps {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}

const authHighlights = [
  { label: 'Canvas pipeline', value: 'story → assets' },
  { label: 'Task recovery', value: 'retry safely' },
  { label: 'Cost ledger', value: 'visible spend' },
]

export function AuthPageShell({ eyebrow, title, description, children }: AuthPageShellProps) {
  return (
    <main className="brand-auth-shell relative min-h-dvh overflow-hidden bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 opacity-[0.32] [background-image:linear-gradient(color-mix(in_oklch,var(--primary)_8%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_oklch,var(--primary)_8%,transparent)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative mx-auto grid min-h-[calc(100dvh-3rem)] w-full max-w-6xl items-center gap-6 lg:grid-cols-[1.04fr_0.96fr]">
        <section className="hidden h-full min-h-[640px] flex-col justify-between rounded-[2rem] border border-border bg-accent/78 p-8 shadow-[var(--shadow-floating)] backdrop-blur-xl lg:flex">
          <div className="flex items-center justify-between">
            <Link to="/" className="group inline-flex items-center gap-3 rounded-full bg-card/74 py-2 pl-2 pr-4 text-sm font-semibold text-foreground shadow-[var(--shadow-level1)] transition hover:bg-card">
              <img src="/logo.webp" alt="Excuse" className="size-9 rounded-full object-cover transition group-hover:scale-105" />
              Excuse
            </Link>
            <span className="rounded-full border border-border bg-card/56 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate">
              Gallery light
            </span>
          </div>

          <div className="max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
            <h1 className="mt-5 max-w-[12ch] text-balance text-5xl font-semibold leading-[1.03] tracking-[-0.035em] text-foreground">
              让创意生产保持清楚、稳定、可追溯。
            </h1>
            <p className="mt-6 max-w-lg text-pretty text-base leading-7 text-muted-foreground">
              从提示词、故事、参考素材到可复用资产，Excuse 把生成过程、成本和失败恢复放在同一个专业工作台里。
            </p>
          </div>

          <div className="grid gap-3">
            <div className="rounded-[1.75rem] border border-border bg-card/68 p-5 shadow-[var(--shadow-floating)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">今日生产状态</p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-foreground">18 runs</p>
                </div>
                <div className="rounded-full bg-primary-container px-3 py-1 text-xs font-semibold text-on-primary-container">96.4% stable</div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                {authHighlights.map(item => (
                  <div key={item.label} className="rounded-2xl border border-border bg-background/82 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{item.label}</p>
                    <p className="mt-2 text-sm font-medium text-foreground">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-full border border-border bg-card/54 px-4 py-3 text-sm text-muted-foreground">
              <span>AI creative production desk</span>
              <span className="font-medium text-primary">cost · assets · workflow</span>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[480px] rounded-[2rem] border border-border bg-card/86 p-5 shadow-[var(--shadow-floating)] backdrop-blur-xl sm:p-7 lg:ml-auto">
          <div className="mb-8 flex items-center justify-between gap-4 lg:hidden">
            <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <img src="/logo.webp" alt="Excuse" className="size-9 rounded-full object-cover" />
              Excuse
            </Link>
            <span className="rounded-full bg-primary-container px-3 py-1 text-xs font-medium text-on-primary-container">Creative desk</span>
          </div>

          <div className="rounded-[1.5rem] border border-border bg-background/72 p-5 sm:p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
            <h2 className="mt-3 text-balance text-3xl font-semibold leading-tight tracking-[-0.025em] text-foreground">{title}</h2>
            <p className="mt-3 text-pretty text-sm leading-6 text-muted-foreground">{description}</p>
          </div>

          <div className="mt-6">
            {children}
          </div>
        </section>
      </div>
    </main>
  )
}
