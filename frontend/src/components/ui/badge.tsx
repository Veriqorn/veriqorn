import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold transition-colors', {
  variants: {
    variant: {
      default: 'bg-primary/12 text-primary',
      secondary: 'bg-secondary text-secondary-foreground',
      destructive: 'bg-destructive/12 text-destructive',
      outline: 'border border-border text-foreground',
      success: 'bg-success/12 text-success',
      warning: 'bg-warning/12 text-warning',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
