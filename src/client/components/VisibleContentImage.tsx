import type { CSSProperties } from "react";
import type { ImageThemeComponent, StoredAsset } from "../../shared/theme";
import { isUnpaddedFullFrame, resolveVisibleContentViewport } from "../visibleContentGeometry";

type VisibleContentImageProps = {
  asset: StoredAsset;
  mode: ImageThemeComponent["imageContentMode"];
  paddingPct: number;
  fit: ImageThemeComponent["backgroundImageFit"];
  position: ImageThemeComponent["backgroundImagePosition"];
  alt: string;
  className?: string;
};

function resolveObjectFit(fit: ImageThemeComponent["backgroundImageFit"]): CSSProperties["objectFit"] {
  switch (fit) {
    case "contain":
      return "contain";
    case "stretch":
      return "fill";
    default:
      return "cover";
  }
}

function resolveObjectPosition(position: ImageThemeComponent["backgroundImagePosition"]): CSSProperties["objectPosition"] {
  switch (position) {
    case "top":
      return "center top";
    case "bottom":
      return "center bottom";
    case "left":
      return "left center";
    case "right":
      return "right center";
    default:
      return "center center";
  }
}

export function VisibleContentImage({
  asset,
  mode,
  paddingPct,
  fit,
  position,
  alt,
  className = "event-logo-image"
}: VisibleContentImageProps) {
  const viewport =
    mode === "visible-pixels"
      ? resolveVisibleContentViewport(asset.visibleContent, paddingPct, fit, position)
      : null;
  const useFullCanvas =
    !viewport || isUnpaddedFullFrame(asset.visibleContent, paddingPct);

  if (useFullCanvas) {
    return (
      <img
        alt={alt}
        src={asset.url}
        className={className}
        style={{ objectFit: resolveObjectFit(fit), objectPosition: resolveObjectPosition(position) }}
      />
    );
  }

  const analysis = asset.visibleContent;
  if (!analysis || analysis.status !== "ready") {
    return null;
  }

  return (
    <svg
      aria-label={alt}
      role="img"
      className={className}
      data-visible-content="true"
      viewBox={viewport.viewBox}
      preserveAspectRatio={viewport.preserveAspectRatio}
    >
      <image
        href={asset.url}
        width={analysis.sourceWidth}
        height={analysis.sourceHeight}
        preserveAspectRatio="none"
      />
    </svg>
  );
}
