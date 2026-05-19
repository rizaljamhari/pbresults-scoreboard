import { Link, Outlet, useLocation } from "react-router-dom";
import { ToastViewport } from "./ToastViewport";
import { cn } from "../lib/utils";

function navLinkClass(active: boolean) {
  return cn(
    "relative flex min-h-12 items-center rounded-full px-4 py-3 font-medium transition-all duration-md3 ease-md3",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md3-primary focus-visible:ring-offset-2",
    active
      ? "bg-md3-secondaryContainer text-md3-onPrimaryContainer"
      : "text-md3-onSurfaceVariant hover:bg-md3-primary/10 hover:text-md3-onPrimaryContainer"
  );
}

export function AppShell() {
  const location = useLocation();

  const navItems = [
    {
      to: "/admin/operations",
      label: "Operations",
      active: location.pathname === "/admin/operations"
    },
    {
      to: "/admin/themes",
      label: "Themes",
      active: location.pathname.startsWith("/admin/themes")
    },
    {
      to: "/admin/teams",
      label: "Teams",
      active: location.pathname.startsWith("/admin/teams")
    },
    {
      to: "/admin/settings",
      label: "Settings",
      active: location.pathname === "/admin/settings"
    }
  ];

  return (
    <div className="admin-root app-shell bg-md3-background text-md3-onBackground">
      <aside className="sidebar border-r border-md3-outlineVariant bg-md3-surface/90 backdrop-blur-xl">
        <div>
          <p className="eyebrow text-md3-primary">PBResults</p>
          <h1 className="m-0 font-medium text-md3-onBackground">PBResults Scoreboard</h1>
        </div>
        <nav className="sidebar-nav grid gap-1">
          {navItems.map((item) => (
            <Link key={item.to} className={navLinkClass(item.active)} to={item.to}>
              {item.active ? <span aria-hidden className="absolute left-3 h-6 w-1 rounded-full bg-md3-primary" /> : null}
              <span className="pl-2">{item.label}</span>
            </Link>
          ))}
          <a
            className={cn(
              "relative flex min-h-12 items-center rounded-full px-4 py-3 font-medium text-md3-onSurfaceVariant transition-all duration-md3 ease-md3",
              "hover:bg-md3-primary/10 hover:text-md3-onPrimaryContainer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md3-primary focus-visible:ring-offset-2"
            )}
            href="/overlay/live"
            target="_blank"
            rel="noreferrer"
          >
            <span className="pl-2">
            Open Live Overlay
            </span>
          </a>
        </nav>
      </aside>
      <main className="content bg-md3-background">
        <Outlet key={location.pathname} />
      </main>
      <ToastViewport />
    </div>
  );
}
