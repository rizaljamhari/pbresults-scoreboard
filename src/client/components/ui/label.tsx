import * as React from "react";
import { cn } from "../../lib/utils";

function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("grid gap-1 text-sm font-medium text-md3-onSurfaceVariant", className)} {...props} />;
}

export { Label };
