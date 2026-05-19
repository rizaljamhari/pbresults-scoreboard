import * as React from "react";
import { cn } from "../../lib/utils";

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...props }, ref) => {
  return (
    <input
      type="checkbox"
      className={cn(
        "h-4 w-4 rounded border-md3-outline text-md3-primary accent-[var(--md3-primary)] transition-all duration-md3fast ease-md3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md3-primary",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Checkbox.displayName = "Checkbox";

export { Checkbox };
