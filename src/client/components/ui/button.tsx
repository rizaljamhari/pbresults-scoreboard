import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-all duration-md3 ease-md3 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md3-primary focus-visible:ring-offset-2 active:scale-95",
  {
    variants: {
      variant: {
        default: "bg-md3-primary text-md3-onPrimary shadow-md31 hover:bg-md3-primary/90",
        secondary:
          "border border-md3-outlineVariant bg-md3-surface text-md3-onPrimaryContainer hover:bg-md3-surfaceContainerLow",
        outline: "border border-md3-outline bg-transparent text-md3-primary hover:bg-md3-primary/10",
        ghost: "bg-transparent text-md3-primary hover:bg-md3-primary/10",
        danger: "bg-md3-danger text-md3-onPrimary shadow-md31 hover:bg-md3-danger/90"
      },
      size: {
        default: "h-10 px-5",
        sm: "h-9 px-4",
        lg: "h-12 px-6",
        icon: "h-10 w-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => {
  return <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
