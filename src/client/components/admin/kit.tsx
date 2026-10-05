import { forwardRef, useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type RefObject } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check, Search } from "lucide-react";
import { cn } from "../../lib/utils";

/** The admin's shared controls. Styles live in admin.css (.ad-*); every page that uses them sits inside .ad-scope. */

type ButtonVariant = "default" | "primary" | "ghost" | "text" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "md" | "sm" }
>(function Button({ variant = "default", size = "md", className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn("ad-btn", variant !== "default" && `ad-btn--${variant}`, size === "sm" && "ad-btn--sm", className)}
      {...props}
    />
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function IconButton({ label, className, type = "button", title, ...props }, ref) {
    return <button ref={ref} type={type} className={cn("ad-icon-btn", className)} aria-label={label} title={title ?? label} {...props} />;
  }
);

export type Tone = "neutral" | "ok" | "warning" | "critical" | "air" | "blue" | "quiet" | "rehearsal";

export function Chip({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cn("ad-chip", tone !== "neutral" && `ad-chip--${tone}`, className)} title={title}>
      {children}
    </span>
  );
}

export function Dot({ tone, flat = false }: { tone?: "live" | "tally" | "warning" | "critical" | "rehearsal"; flat?: boolean }) {
  return <span className={cn("ad-dot", tone && `ad-dot--${tone}`, flat && "ad-dot--flat")} aria-hidden />;
}

/** One page's toolbar: title, then the page's search, filters and actions. */
export function Toolbar({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <header className="ad-toolbar">
      <h1>
        {title}
        {count !== undefined ? <span className="ad-toolbar-count">{count}</span> : null}
      </h1>
      {children}
    </header>
  );
}

export function Grow() {
  return <div className="ad-grow" />;
}

export const SearchField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; shortcut?: string }>(
  function SearchField({ label, shortcut, className, ...props }, ref) {
    return (
      <label className={cn("ad-search", className)}>
        <Search aria-hidden />
        <input ref={ref} className="ad-input" type="search" aria-label={label} {...props} />
        {shortcut ? <kbd aria-hidden>{shortcut}</kbd> : null}
      </label>
    );
  }
);

/** Mutually exclusive choice as a small segmented control. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode; count?: number; title?: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("ad-seg", className)} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined ? <span className="ad-seg-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  // Inside a form, Radix adds a hidden absolutely positioned checkbox next to the switch. The wrapper gives it a
  // containing block, so it scrolls with the switch instead of stretching the whole page.
  return (
    <span className="ad-switch-wrap">
      <SwitchPrimitive.Root id={id} className="ad-switch" checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled}>
        <SwitchPrimitive.Thumb className="ad-switch-thumb" />
      </SwitchPrimitive.Root>
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="ad-field">
      <label className="ad-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint ? <p className="ad-hint" style={{ marginTop: 5 }}>{hint}</p> : null}
    </div>
  );
}

/**
 * A settings row: what it is and why on the left, the control on the right. Pass `htmlFor` with the control's id so
 * the title is its label and clicking it focuses the control.
 */
export function SettingRow({
  title,
  hint,
  children,
  dim = false,
  htmlFor
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  dim?: boolean;
  htmlFor?: string;
}) {
  return (
    <div className={cn("ad-set-row", dim && "is-dim")}>
      <div className="ad-set-text">
        {htmlFor ? (
          <label className="ad-set-title" htmlFor={htmlFor}>
            {title}
          </label>
        ) : (
          <b className="ad-set-title">{title}</b>
        )}
        {hint ? <p className="ad-hint">{hint}</p> : null}
      </div>
      <div className="ad-set-ctl">{children}</div>
    </div>
  );
}

export type MenuItem =
  | {
      kind?: "item";
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      /** A switch-like item: shows a tick while on. */
      checked?: boolean;
      /** A keyboard shortcut or short note, at the end of the row. */
      hint?: string;
    }
  | { kind: "separator" };

/** A "…" style menu. Portalled, so it carries the admin scope itself. */
export function Menu({ trigger, items, align = "end" }: { trigger: ReactNode; items: MenuItem[]; align?: "start" | "end" }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ad-scope ad-pop" align={align} sideOffset={6}>
          {items.map((item, index) =>
            item.kind === "separator" ? (
              <DropdownMenu.Separator key={`sep-${index}`} className="ad-menu-sep" />
            ) : (
              <MenuRow key={item.label} item={item} />
            )
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuRow({ item }: { item: Extract<MenuItem, { label: string }> }) {
  const content = (
    <>
      {item.icon}
      {item.label}
      {item.hint || item.checked !== undefined ? (
        <span className="ad-menu-end">
          {item.hint ? <kbd className="ad-kbd">{item.hint}</kbd> : null}
          {item.checked ? <Check aria-hidden /> : null}
        </span>
      ) : null}
    </>
  );
  const className = cn("ad-menu-item", item.danger && "ad-menu-item--danger");
  // A switch-like item is a checkbox item, so screen readers hear whether it is on.
  return item.checked !== undefined ? (
    <DropdownMenu.CheckboxItem className={className} disabled={item.disabled} checked={item.checked} onSelect={item.onSelect}>
      {content}
    </DropdownMenu.CheckboxItem>
  ) : (
    <DropdownMenu.Item className={className} disabled={item.disabled} onSelect={item.onSelect}>
      {content}
    </DropdownMenu.Item>
  );
}

/** "/" focuses the page search, as the placeholder hint says, unless you are already typing somewhere. */
export function useSlashFocus(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ref]);
}

/** Download a JSON payload as a file. */
export function downloadJson(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** The save shortcut as this computer writes it. */
export const SAVE_SHORTCUT = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘S" : "Ctrl+S";
