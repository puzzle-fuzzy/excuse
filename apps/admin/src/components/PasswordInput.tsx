import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useState } from 'react'
import { Input } from '@/components/ui/input'

const PasswordInput = forwardRef<HTMLInputElement, React.ComponentProps<'input'>>((props, ref) => {
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={show ? 'text' : 'password'}
        {...props}
        className={`pr-10 ${props.className ?? ''}`}
      />
      <button
        type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={() => setShow(v => !v)}
        tabIndex={-1}
        aria-label={show ? '隐藏密码' : '显示密码'}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
})

PasswordInput.displayName = 'PasswordInput'

export { PasswordInput }
