import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Link } from 'react-router'

interface AuthPageShellProps {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}

const valuePoints = [
  { dot: 'bg-primary', text: '创作流水线：从故事到成片，阶段连贯、可追溯' },
  { dot: 'bg-[color:var(--brand-image)]', text: '成本透明：每一次生成的用量与花费都看得见' },
  { dot: 'bg-[color:var(--brand-video)]', text: '失败可恢复：任务自动重试，进度不丢失' },
]

export function AuthPageShell({ eyebrow, title, description, children }: AuthPageShellProps) {
  return (
    <main className="brand-auth-shell relative min-h-dvh overflow-hidden bg-background text-foreground">
      {/* 极淡网格底纹 */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.26] [background-image:linear-gradient(color-mix(in_oklch,var(--primary)_7%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_oklch,var(--primary)_7%,transparent)_1px,transparent_1px)] [background-size:46px_46px]" />

      {/* 固定左上品牌 */}
      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10 lg:px-14">
        <Link to="/" className="group inline-flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-level1)] transition group-hover:scale-105">
            <Sparkles className="size-5" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-base font-semibold tracking-tight text-foreground">Excuse</span>
            <span className="mt-1 text-[11px] font-medium text-muted-foreground">创意生产工作台</span>
          </span>
        </Link>
        <Link
          to="/login"
          className="hidden rounded-full border border-border bg-card/70 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm transition hover:text-foreground sm:inline-flex"
        >
          返回登录
        </Link>
      </header>

      {/* 主体：左品牌叙事 + 右悬浮表单卡 */}
      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col items-stretch gap-12 px-6 pb-16 sm:px-10 lg:flex-row lg:items-center lg:gap-16 lg:px-14 lg:pb-0">
        {/* 背景品牌叙事（桌面） */}
        <div className="hidden max-w-xl lg:block">
          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.035em] text-foreground xl:text-6xl">
            让想象力，
            <br />
            拥有生产力。
          </h1>
          <p className="mt-7 max-w-md text-pretty text-lg leading-8 text-muted-foreground">
            从提示词、故事、参考素材到可复用资产——把生成过程、成本与失败恢复放进同一个专业工作台。
          </p>
          <ul className="mt-10 space-y-3.5">
            {valuePoints.map(point => (
              <li key={point.text} className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
                <span className={`mt-2 size-1.5 shrink-0 rounded-full ${point.dot}`} />
                <span>{point.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 悬浮表单卡 */}
        <section className="mx-auto w-full max-w-[460px] self-center rounded-3xl border border-border bg-card/92 p-6 shadow-[var(--shadow-floating)] backdrop-blur-xl sm:p-8 lg:ml-auto lg:mr-2">
          {/* 移动端品牌头 */}
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </span>
            <span className="text-sm font-semibold text-foreground">Excuse · 创意生产工作台</span>
          </div>

          <p className="text-xs font-semibold tracking-wide text-primary">{eyebrow}</p>
          <h2 className="mt-3 text-balance text-2xl font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-3xl">
            {title}
          </h2>
          <p className="mt-2.5 text-pretty text-sm leading-6 text-muted-foreground">{description}</p>

          <div className="mt-7">
            {children}
          </div>
        </section>
      </div>
    </main>
  )
}
