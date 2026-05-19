import * as React from "react";
import { cn } from "../../lib/utils";

function FormGrid({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-4", className)} {...props} />;
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-2", className)} {...props} />;
}

function FieldHint({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("m-0 text-sm text-md3-onSurfaceVariant", className)} {...props} />;
}

function ActionRow({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-between gap-3", className)} {...props} />;
}

export { FormGrid, FieldGroup, FieldHint, ActionRow };
