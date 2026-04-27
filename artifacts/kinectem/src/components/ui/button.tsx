import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
           // @replit: no hover, and add primary border
           "bg-primary text-primary-foreground border border-primary-border",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border-destructive-border",
        outline:
          // @replit Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color. Uses shadow-xs. no shadow on active
          // No hover state
          " border [border-color:var(--button-outline)] shadow-xs active:shadow-none ",
        secondary:
          // @replit border, no hover, no shadow, secondary border.
          "border bg-secondary text-secondary-foreground border border-secondary-border ",
        // @replit no hover, transparent border
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
        // Kinectem brand pill: purple→blue gradient, fully rounded, white bold text.
        // Use this for primary calls-to-action so the brand styling stays consistent
        // and doesn't drift back to the plain `bg-primary` blue.
        brand:
          "brand-gradient hover:opacity-90 text-white font-bold rounded-full",
        // Same gradient, but as a full-width rounded-xl block — used for auth and form submit buttons.
        brandBlock:
          "brand-gradient hover:opacity-90 text-white font-bold rounded-xl w-full",
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
