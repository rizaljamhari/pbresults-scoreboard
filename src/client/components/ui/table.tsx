import * as React from "react";
import { cn } from "../../lib/utils";

const TableShell = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "max-h-[60vh] overflow-x-auto overflow-y-auto rounded-md3m border border-md3-outlineVariant bg-md3-surface",
      className
    )}
    {...props}
  />
));
TableShell.displayName = "TableShell";

const Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(({ className, ...props }, ref) => (
  <table ref={ref} className={cn("w-full border-separate border-spacing-0 bg-md3-surface", className)} {...props} />
));
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn(className)} {...props} />
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:hover]:bg-md3-surfaceContainer", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn(className)} {...props} />
));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "sticky top-0 z-10 border-b border-md3-outlineVariant px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-md3-onSurfaceVariant",
      className
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("border-b border-md3-outlineVariant px-3 py-3 align-middle", className)} {...props} />
));
TableCell.displayName = "TableCell";

const TableEmpty = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("px-3 py-5 text-center text-sm text-md3-onSurfaceVariant", className)} {...props} />
  )
);
TableEmpty.displayName = "TableEmpty";

export { TableShell, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty };
