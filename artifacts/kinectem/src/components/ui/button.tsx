import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
           "bg-primary text-primary-foreground border border-primary-border shadow-sm hover:bg-primary/90 active:bg-primary/80 active:scale-[0.98]",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive-border shadow-sm hover:bg-destructive/90 active:bg-destructive/80 active:scale-[0.98]",
        outline:
          "border border-border bg-transparent shadow-sm hover:bg-muted hover:text-foreground active:bg-muted/80 active:scale-[0.98]",
        secondary:
          "bg-secondary text-secondary-foreground border border-secondary-border shadow-sm hover:bg-secondary/80 active:bg-secondary/60 active:scale-[0.98]",
        ghost:
          "border border-transparent hover:bg-muted hover:text-foreground active:bg-muted/80 active:scale-[0.98]",
        link:
          "text-primary underline-offset-4 hover:underline",
        brand:
          "brand-gradient hover:opacity-90 active:opacity-100 active:scale-[0.98] text-white font-bold rounded-full shadow-md hover:shadow-lg",
        brandBlock:
          "brand-gradient hover:opacity-90 active:opacity-100 active:scale-[0.98] text-white font-bold rounded-xl w-full shadow-md hover:shadow-lg",
      },
      size: {
        // @replit changed sizes
        default: "min-h-9 px-4 py-2",
        // Tiny inline pill height — used for accept / dismiss style buttons in dense lists.
        xs: "h-7 px-3 text-xs",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    compoundVariants: [
      // Brand pill default size = roomy px-6 (the standard primary action)
      { variant: "brand", size: "default", className: "px-6" },
      // Brand pill stays a pill at every size — never picks up `rounded-md`
      { variant: "brand", size: "sm", className: "rounded-full" },
      { variant: "brand", size: "lg", className: "rounded-full" },
      { variant: "brand", size: "xs", className: "rounded-full" },
      { variant: "brand", size: "icon", className: "rounded-full" },
      // Brand block (auth / form submit) gets the standard h-11 height
      { variant: "brandBlock", size: "default", className: "h-11" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
