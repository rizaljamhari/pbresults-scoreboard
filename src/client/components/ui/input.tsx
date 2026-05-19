import * as React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-md3s border border-md3-outline bg-md3-surface px-3 py-2 text-sm text-md3-onBackground shadow-none transition-colors duration-md3fast ease-md3 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-md3-onSurfaceVariant/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md3-primary",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
