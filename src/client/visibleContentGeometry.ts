import type { ImageThemeComponent, VisibleContentAnalysis } from "../shared/theme";

type ImageFit = ImageThemeComponent["backgroundImageFit"];
type ImagePosition = ImageThemeComponent["backgroundImagePosition"];

export type VisibleContentViewport = {
  viewBox: string;
  preserveAspectRatio: string;
};

function resolveAlignment(position: ImagePosition): string {
  switch (position) {
    case "top":
      return "xMidYMin";
    case "bottom":
      return "xMidYMax";
    case "left":
      return "xMinYMid";
    case "right":
      return "xMaxYMid";
    default:
      return "xMidYMid";
  }
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(4)).toString();
}

export function resolveVisibleContentViewport(
  analysis: VisibleContentAnalysis | null,
  paddingPct: number,
  fit: ImageFit,
  position: ImagePosition
): VisibleContentViewport | null {
  if (analysis?.status !== "ready") {
    return null;
  }
  if (
    analysis.x + analysis.width > analysis.sourceWidth ||
    analysis.y + analysis.height > analysis.sourceHeight
  ) {
    return null;
  }

  const normalizedPadding = Math.min(25, Math.max(0, paddingPct)) / 100;
  const paddingX = analysis.width * normalizedPadding;
  const paddingY = analysis.height * normalizedPadding;
  const x = analysis.x - paddingX;
  const y = analysis.y - paddingY;
  const width = analysis.width + paddingX * 2;
  const height = analysis.height + paddingY * 2;

  return {
    viewBox: [x, y, width, height].map(formatCoordinate).join(" "),
    preserveAspectRatio: fit === "stretch" ? "none" : `${resolveAlignment(position)} ${fit === "cover" ? "slice" : "meet"}`
  };
}

export function isUnpaddedFullFrame(analysis: VisibleContentAnalysis | null, paddingPct: number): boolean {
  return Boolean(
    analysis?.status === "ready" &&
      paddingPct === 0 &&
      analysis.x === 0 &&
      analysis.y === 0 &&
      analysis.width === analysis.sourceWidth &&
      analysis.height === analysis.sourceHeight
  );
}
