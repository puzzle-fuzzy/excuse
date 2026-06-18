import { Slider as SliderPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Slider({
  className,
  defaultValue,
  value,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const hasValue = value !== undefined || defaultValue !== undefined
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      className={cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          'relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5',
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn(
            'absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full',
            !hasValue && 'hidden',
          )}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        className={cn(
          'block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm ring-offset-background transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          !hasValue && 'hidden',
        )}
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
