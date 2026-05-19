import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide", {
  variants: {
    variant: {
      default: "bg-md3-surfaceContainerLow text-md3-onSurfaceVariant",
      success: "bg-[var(--md3-success-container)] text-[#245b32]",
      warning: "bg-[#fff0c2] text-[#7a4b00]",
      critical: "bg-[var(--md3-danger-container)] text-[#962b22]",
      info: "bg-[#dceeff] text-[#0d4a7c]"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
