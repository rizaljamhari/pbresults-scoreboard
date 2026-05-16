import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ScaledCanvasFrameProps = {
  width: number;
  height: number;
  className?: string;
  innerClassName?: string;
  mode?: "contain" | "width";
  zoom?: number;
  children: ReactNode | ((scale: number) => ReactNode);
};

export function ScaledCanvasFrame({
  width,
  height,
  className,
  innerClassName,
  mode = "contain",
  zoom = 1,
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
    const widthScale = containerSize.width / width;
    const heightScale = containerSize.height / height;
    const nextScale = mode === "width" ? widthScale : Math.min(widthScale, heightScale);
    return Math.min(1, Math.max(0.1, nextScale));
  }, [containerSize.height, containerSize.width, height, mode, width]);

  const appliedScale = useMemo(() => Math.max(0.1, scale * zoom), [scale, zoom]);

  return (
    <div ref={containerRef} className={className}>
      <div
        className={innerClassName}
        style={{
          width: Math.round(width * appliedScale),
          height: Math.round(height * appliedScale)
        }}
      >
        <div
          style={{
            width,
            height,
            position: "relative",
            transform: `scale(${appliedScale})`,
            transformOrigin: "top left"
          }}
        >
          {typeof children === "function" ? children(appliedScale) : children}
        </div>
      </div>
    </div>
  );
}
