import { useState, type ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  CopyPlus,
  FlipHorizontal2,
  Layers,
  Lock,
  LockOpen,
  Trash2
} from "lucide-react";
import type { AlignEdge, ArrangeReference, Axis } from "../../../shared/themeArrange";
import { IconButton } from "./EditorChrome";

export type StackAction = "bringForward" | "bringBackward" | "sendToFront" | "sendToBack";

/** Everything the arrange panel and the right-click menu can do for the current selection. */
export type ArrangeActions = {
  count: number;
  reference: ArrangeReference;
  setReference: (reference: ArrangeReference) => void;
  align: (edge: AlignEdge) => void;
  distribute: (axis: Axis) => void;
  setGap: (axis: Axis, gap: number) => void;
  matchSize: (dimension: "width" | "height") => void;
  /** Present only when the selection is one team piece with a counterpart. */
  mirror?: { label: string; run: () => void };
  locked: boolean;
  toggleLock: () => void;
  canReorder: boolean;
  reorder: (action: StackAction) => void;
  /** Present only for custom pieces. */
  duplicate?: () => void;
  remove?: () => void;
};

const ALIGN_BUTTONS: Array<{ edge: AlignEdge; label: string; icon: ReactNode }> = [
  { edge: "left", label: "Align left", icon: <AlignStartVertical /> },
  { edge: "centerX", label: "Align centres horizontally", icon: <AlignCenterVertical /> },
  { edge: "right", label: "Align right", icon: <AlignEndVertical /> },
  { edge: "top", label: "Align top", icon: <AlignStartHorizontal /> },
  { edge: "middle", label: "Align middles vertically", icon: <AlignCenterHorizontal /> },
  { edge: "bottom", label: "Align bottom", icon: <AlignEndHorizontal /> }
];

export function ArrangePanel({ actions }: { actions: ArrangeActions }) {
  const [gap, setGap] = useState(8);
  const toFrame = actions.count === 1 || actions.reference === "frame";

  return (
    <section className="te-arrange" aria-label="Arrange">
      <div className="te-arrange-head">
        <h3 className="te-group-title">Arrange</h3>
        {actions.count > 1 ? (
          <div className="te-seg" role="radiogroup" aria-label="Align to">
            <button
              type="button"
              role="radio"
              aria-checked={actions.reference === "selection"}
              onClick={() => actions.setReference("selection")}
            >
              Selection
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={actions.reference === "frame"}
              onClick={() => actions.setReference("frame")}
            >
              Frame
            </button>
          </div>
        ) : (
          <span className="te-arrange-note">to the frame</span>
        )}
      </div>

      <div className="te-arrange-row" role="group" aria-label={toFrame ? "Align to the frame" : "Align to the selection"}>
        {ALIGN_BUTTONS.map(({ edge, label, icon }) => (
          <IconButton key={edge} label={label} onClick={() => actions.align(edge)}>
            {icon}
          </IconButton>
        ))}
      </div>

      {actions.count > 1 ? (
        <div className="te-arrange-row">
          <IconButton label="Distribute horizontally" shortcut="⌥⇧H" disabled={actions.count < 3} onClick={() => actions.distribute("x")}>
            <AlignHorizontalDistributeCenter />
          </IconButton>
          <IconButton label="Distribute vertically" shortcut="⌥⇧V" disabled={actions.count < 3} onClick={() => actions.distribute("y")}>
            <AlignVerticalDistributeCenter />
          </IconButton>
          <span className="te-sep" aria-hidden />
          <label className="te-gap">
            <span>Gap</span>
            <input
              type="number"
              min={0}
              value={gap}
              onChange={(event) => setGap(Math.max(0, Number(event.target.value) || 0))}
              aria-label="Gap in frame pixels"
            />
          </label>
          <button type="button" className="te-mini-btn" onClick={() => actions.setGap("x", gap)} title="Lay out left to right with this gap">
            ↔ Apply
          </button>
          <button type="button" className="te-mini-btn" onClick={() => actions.setGap("y", gap)} title="Lay out top to bottom with this gap">
            ↕ Apply
          </button>
        </div>
      ) : null}

      {actions.count > 1 ? (
        <div className="te-arrange-row">
          <button type="button" className="te-mini-btn" onClick={() => actions.matchSize("width")} title="Give every piece the first piece's width">
            Same width
          </button>
          <button type="button" className="te-mini-btn" onClick={() => actions.matchSize("height")} title="Give every piece the first piece's height">
            Same height
          </button>
          <span className="te-row-spacer" />
          <IconButton label={actions.locked ? "Unlock" : "Lock position"} pressed={actions.locked} onClick={actions.toggleLock}>
            {actions.locked ? <Lock /> : <LockOpen />}
          </IconButton>
        </div>
      ) : null}

      {actions.canReorder ? (
        <div className="te-arrange-row" role="group" aria-label="Layer order">
          <IconButton label="Send to back" shortcut="⌘⇧[" onClick={() => actions.reorder("sendToBack")}>
            <ArrowDownToLine />
          </IconButton>
          <IconButton label="Send backward" shortcut="⌘[" onClick={() => actions.reorder("bringBackward")}>
            <ArrowDown />
          </IconButton>
          <IconButton label="Bring forward" shortcut="⌘]" onClick={() => actions.reorder("bringForward")}>
            <ArrowUp />
          </IconButton>
          <IconButton label="Bring to front" shortcut="⌘⇧]" onClick={() => actions.reorder("sendToFront")}>
            <ArrowUpToLine />
          </IconButton>
          {actions.duplicate ? (
            <IconButton label="Duplicate" shortcut="⌘D" onClick={actions.duplicate}>
              <CopyPlus />
            </IconButton>
          ) : null}
          <span className="te-row-spacer" />
          {actions.mirror ? (
            <IconButton label={`${actions.mirror.label} (copies once)`} onClick={actions.mirror.run}>
              <FlipHorizontal2 />
            </IconButton>
          ) : null}
          <IconButton label={actions.locked ? "Unlock" : "Lock position"} pressed={actions.locked} onClick={actions.toggleLock}>
            {actions.locked ? <Lock /> : <LockOpen />}
          </IconButton>
        </div>
      ) : null}
    </section>
  );
}

/** The same actions as a right-click menu on the canvas. */
export function ArrangeMenuItems({ actions }: { actions: ArrangeActions }) {
  const item = (label: string, run: () => void, icon?: ReactNode, shortcut?: string, disabled?: boolean) => (
    <ContextMenu.Item className="te-menu-item" onSelect={run} disabled={disabled}>
      {icon}
      <span className="te-menu-label">{label}</span>
      {shortcut ? <kbd className="te-menu-kbd">{shortcut}</kbd> : null}
    </ContextMenu.Item>
  );

  return (
    <>
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger className="te-menu-item">
          <AlignStartVertical />
          <span className="te-menu-label">Align {actions.count === 1 || actions.reference === "frame" ? "to frame" : "selection"}</span>
          <span aria-hidden>›</span>
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent className="te-menu" sideOffset={4}>
            {ALIGN_BUTTONS.map(({ edge, label, icon }) => (
              <ContextMenu.Item key={edge} className="te-menu-item" onSelect={() => actions.align(edge)}>
                {icon}
                <span className="te-menu-label">{label}</span>
              </ContextMenu.Item>
            ))}
            {actions.count > 2 ? (
              <>
                <ContextMenu.Separator className="te-menu-sep" />
                {item("Distribute horizontally", () => actions.distribute("x"), <AlignHorizontalDistributeCenter />, "⌥⇧H")}
                {item("Distribute vertically", () => actions.distribute("y"), <AlignVerticalDistributeCenter />, "⌥⇧V")}
              </>
            ) : null}
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
      {actions.count > 1 ? (
        <>
          {item("Same width", () => actions.matchSize("width"))}
          {item("Same height", () => actions.matchSize("height"))}
        </>
      ) : null}
      {actions.mirror ? item(actions.mirror.label, actions.mirror.run, <FlipHorizontal2 />) : null}
      <ContextMenu.Separator className="te-menu-sep" />
      {actions.canReorder ? (
        <>
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className="te-menu-item">
              <Layers />
              <span className="te-menu-label">Order</span>
              <span aria-hidden>›</span>
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="te-menu" sideOffset={4}>
                {item("Bring forward", () => actions.reorder("bringForward"), <ArrowUp />, "⌘]")}
                {item("Send backward", () => actions.reorder("bringBackward"), <ArrowDown />, "⌘[")}
                {item("Bring to front", () => actions.reorder("sendToFront"), <ArrowUpToLine />, "⌘⇧]")}
                {item("Send to back", () => actions.reorder("sendToBack"), <ArrowDownToLine />, "⌘⇧[")}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Separator className="te-menu-sep" />
        </>
      ) : null}
      {item(actions.locked ? "Unlock" : "Lock position", actions.toggleLock, actions.locked ? <Lock /> : <LockOpen />)}
      {actions.duplicate ? item("Duplicate", actions.duplicate, <CopyPlus />, "⌘D") : null}
      {actions.remove ? item("Delete", actions.remove, <Trash2 />) : null}
    </>
  );
}
