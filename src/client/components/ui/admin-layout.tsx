import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

function AdminPageFrame({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("admin-page-frame", className)} {...props} />;
}

type AdminPageHeaderProps = {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

function AdminPageHeader({ eyebrow, title, description, actions, className }: AdminPageHeaderProps) {
  return (
    <header className={cn("admin-page-header-shell", className)}>
      <div className="grid gap-1.5">
        {eyebrow ? <p className="admin-page-eyebrow">{eyebrow}</p> : null}
        <h2 className="admin-page-title">{title}</h2>
        {description ? <div className="admin-page-description">{description}</div> : null}
      </div>
      {actions ? <div className="admin-page-header-actions">{actions}</div> : null}
    </header>
  );
}

function AdminFilterBar({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("admin-filter-bar", className)} {...props} />;
}

const statusPanelVariants = cva("grid gap-3 rounded-md3m border p-4", {
  variants: {
    tone: {
      neutral: "border-md3-outlineVariant bg-md3-surface",
      success: "border-[#245b3228] bg-[var(--md3-success-container)]",
      warning: "border-[#b8800038] bg-[#fff9e8]",
      critical: "border-[#c93a2c38] bg-[#fff2f0]",
      info: "border-[#005fa32e] bg-[#eef7ff]"
    },
    density: {
      comfortable: "gap-3 p-4",
      compact: "gap-2 p-3"
    }
  },
  defaultVariants: {
    tone: "neutral",
    density: "comfortable"
  }
});

interface StatusPanelProps extends React.ComponentProps<"section">, VariantProps<typeof statusPanelVariants> {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

function StatusPanel({ className, tone, density, icon, title, description, action, children, ...props }: StatusPanelProps) {
  return (
    <section className={cn(statusPanelVariants({ tone, density }), className)} {...props}>
      {title || description || action ? (
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            {icon ? (
              <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center text-md3-onSurfaceVariant">{icon}</span>
            ) : null}
            <div className="grid gap-1">
              {title ? <h3 className="m-0 text-base font-semibold text-md3-onBackground">{title}</h3> : null}
              {description ? <p className="m-0 text-sm text-md3-onSurfaceVariant">{description}</p> : null}
            </div>
          </div>
          {action ? <div className="flex items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const adminStatTileVariants = cva("grid gap-1.5 rounded-md3m border px-4 py-3", {
  variants: {
    tone: {
      neutral: "border-md3-outlineVariant bg-md3-surface",
      success: "border-[#245b3228] bg-[var(--md3-success-container)]",
      warning: "border-[#b8800038] bg-[#fff9e8]",
      critical: "border-[#c93a2c38] bg-[#fff2f0]",
      info: "border-[#005fa32e] bg-[#eef7ff]"
    }
  },
  defaultVariants: {
    tone: "neutral"
  }
});

interface AdminStatTileProps extends React.ComponentProps<"div">, VariantProps<typeof adminStatTileVariants> {
  icon?: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
}

function AdminStatTile({ className, tone, icon, label, value, detail, ...props }: AdminStatTileProps) {
  return (
    <div className={cn(adminStatTileVariants({ tone }), className)} {...props}>
      <span className="flex items-center gap-1.5 text-[0.72rem] font-bold uppercase tracking-[0.08em] text-md3-onSurfaceVariant">
        {icon ? <span className="inline-flex h-3.5 w-3.5 items-center justify-center">{icon}</span> : null}
        {label}
      </span>
      <strong className="text-base leading-tight text-md3-onBackground">{value}</strong>
      {detail ? <span className="text-sm text-md3-onSurfaceVariant">{detail}</span> : null}
    </div>
  );
}

export { AdminPageFrame, AdminPageHeader, AdminFilterBar, AdminStatTile, StatusPanel };
