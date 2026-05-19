import * as React from "react";
import { cn } from "../../lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[120px] w-full rounded-md3s border border-md3-outline bg-md3-surface px-3 py-2 text-sm text-md3-onBackground shadow-none transition-colors duration-md3fast ease-md3 placeholder:text-md3-onSurfaceVariant/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md3-primary",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
