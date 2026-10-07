import { forwardRef, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CircleHelp } from "lucide-react";
import { cn } from "../../lib/utils";

type IconButtonProps = {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
};

// Icon-only control: the tooltip carries the visible name, aria-label the accessible one.
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, pressed, disabled, onClick, children, className, ...rest },
  ref
) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          ref={ref}
          type="button"
          className={cn("te-icon-btn", className)}
          aria-label={shortcut ? `${label} (${shortcut})` : label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          {...rest}
        >
          {children}
          {shortcut ? <span className="te-icon-btn-key" aria-hidden>{shortcut}</span> : null}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="te-tooltip" side="bottom" sideOffset={6}>
          {label}
          {shortcut ? <kbd>{shortcut}</kbd> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});

export function Island({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    // Right-clicks on floating chrome must not open the canvas menu underneath.
    <div className={cn("te-island", className)} onContextMenu={(event) => event.stopPropagation()} {...props}>
      {children}
    </div>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["V", "Select tool"],
  ["H", "Hand tool (or hold Space)"],
  ["T", "Add text"],
  ["I", "Add image"],
  ["R", "Add shape"],
  ["⌘/Ctrl Alt C, then V", "Copy a piece's style, then paste it onto the selection"],
  ["S", "Snap on or off"],
  ["Drag empty canvas", "Select everything in the box (Shift adds)"],
  ["⌘/Ctrl + drag", "Move without snapping"],
  ["Shift + drag", "Keep one axis; Shift + resize keeps the ratio"],
  ["Alt + drag", "Leave a copy of a custom piece behind"],
  ["⌘/Ctrl D", "Duplicate a custom piece"],
  ["⌘/Ctrl ] or [", "Bring forward or send backward (Shift: to front or back)"],
  ["Alt Shift H or V", "Distribute horizontally or vertically"],
  ["Arrows", "Nudge 1px, Shift for 10px"],
  ["+ / −", "Zoom in or out"],
  ["0", "Fit frame"],
  ["F", "Focus the selected piece"],
  ["⌘/Ctrl S", "Save (Save to air when on air)"],
  ["Delete", "Delete the selected custom piece"],
  ["Tab", "Next piece, when the canvas has focus (Shift: previous)"],
  ["?", "Show these shortcuts"],
  ["⌘/Ctrl Z", "Undo"],
  ["⌘/Ctrl Shift Z", "Redo"],
  ["Esc", "Clear selection"]
];

export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Popover.Trigger asChild>
            <button type="button" className="te-icon-btn" aria-label="Keyboard shortcuts">
              <CircleHelp />
            </button>
          </Popover.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="te-tooltip" side="top" sideOffset={6}>
            Keyboard shortcuts
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      <Popover.Portal>
        <Popover.Content className="te-popover te-shortcuts" side="top" align="end" sideOffset={8}>
          <h3>Keyboard shortcuts</h3>
          <dl>
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
