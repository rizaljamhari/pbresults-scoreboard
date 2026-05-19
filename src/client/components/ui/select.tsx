import * as React from "react";
import { cn } from "../../lib/utils";

const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(({ className, children, ...props }, ref) => {
  return (
    <select
      className={cn(
        "flex h-11 w-full rounded-md3s border border-md3-outline bg-md3-surface px-3 py-2 text-sm text-md3-onBackground transition-colors duration-md3fast ease-md3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md3-primary",
        className
      )}
      ref={ref}
      {...props}
    >
      {children}
    </select>
  );
});
Select.displayName = "Select";

export { Select };
