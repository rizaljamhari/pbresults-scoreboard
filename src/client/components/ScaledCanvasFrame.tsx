import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ScaledCanvasFrameProps = {
  width: number;
  height: number;
  className?: string;
  innerClassName?: string;
  mode?: "contain" | "width";
  zoom?: number;
  camera?: {
    x: number;
    y: number;
  };
  /** Fill the container instead of hugging the fitted frame; the camera positions the frame. */
  fill?: boolean;
  /** Space covered by floating chrome; the fit scale uses what is left. */
  insets?: { top: number; right: number; bottom: number; left: number };
  onScaleChange?: (scale: number) => void;
  children: ReactNode | ((scale: number) => ReactNode);
};

export function ScaledCanvasFrame({
  width,
  height,
  className,
  innerClassName,
  mode = "contain",
  zoom = 1,
  camera,
  fill = false,
  insets,
  onScaleChange,
  children
}: ScaledCanvasFrameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: width, height: height });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const update = () => {
      setContainerSize({
        width: element.clientWidth || width,
        height: element.clientHeight || height
      });
    };

    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(element);
    return () => observer.disconnect();
  }, [height, width]);

  const scale = useMemo(() => {
    const availableWidth = Math.max(1, containerSize.width - (insets ? insets.left + insets.right : 0));
    const availableHeight = Math.max(1, containerSize.height - (insets ? insets.top + insets.bottom : 0));
    const widthScale = availableWidth / width;
    const heightScale = availableHeight / height;
    const nextScale = mode === "width" ? widthScale : Math.min(widthScale, heightScale);
    return Math.min(1, Math.max(0.1, nextScale));
  }, [containerSize.height, containerSize.width, height, insets?.bottom, insets?.left, insets?.right, insets?.top, mode, width]);

  const appliedScale = useMemo(() => Math.max(0.1, scale * zoom), [scale, zoom]);

  useEffect(() => {
    onScaleChange?.(appliedScale);
  }, [appliedScale, onScaleChange]);
  const viewportWidth = useMemo(() => Math.round(width * scale), [width, scale]);
  const viewportHeight = useMemo(() => Math.round(height * scale), [height, scale]);

  return (
    <div ref={containerRef} className={className}>
      <div
        className={innerClassName}
        style={fill ? { width: "100%", height: "100%" } : { width: viewportWidth, height: viewportHeight }}
      >
        <div
          style={{
            width,
            height,
            position: "relative",
            transform: `translate(${camera?.x ?? 0}px, ${camera?.y ?? 0}px) scale(${appliedScale})`,
            transformOrigin: "top left"
          }}
        >
          {typeof children === "function" ? children(appliedScale) : children}
        </div>
      </div>
    </div>
  );
}
