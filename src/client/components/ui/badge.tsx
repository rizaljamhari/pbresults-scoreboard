import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva("inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-[0.72rem] font-semibold tracking-[0.04em]", {
  variants: {
    variant: {
      default: "border-md3-outlineVariant bg-md3-surfaceContainerLow text-md3-onSurfaceVariant",
      success: "border-[#80b08a] bg-[#dcefdc] text-[#1f5a2d]",
      warning: "border-[#d6b256] bg-[#fff3cf] text-[#7a4b00]",
      critical: "border-[#e0a7a2] bg-[#f9dedc] text-[#962b22]",
      info: "border-[#9bc2ea] bg-[#e5f1ff] text-[#0d4a7c]"
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
