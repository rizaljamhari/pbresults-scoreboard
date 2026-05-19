import * as React from "react";
import { cn } from "../../lib/utils";

function DropdownMenu({ className, ...props }: React.ComponentProps<"details">) {
  return <details className={cn("relative", className)} {...props} />;
}

function DropdownMenuTrigger({ className, ...props }: React.ComponentProps<"summary">) {
  return <summary className={cn("list-none [&::-webkit-details-marker]:hidden", className)} {...props} />;
}

function DropdownMenuContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "absolute right-0 top-[calc(100%+6px)] z-30 grid min-w-[160px] gap-2 rounded-md3s border border-md3-outlineVariant bg-md3-surface p-2 shadow-md32",
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuUpContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "absolute bottom-[calc(100%+6px)] right-0 z-30 grid min-w-[160px] gap-2 rounded-md3s border border-md3-outlineVariant bg-md3-surface p-2 shadow-md32",
        className
      )}
      {...props}
    />
  );
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuUpContent };
