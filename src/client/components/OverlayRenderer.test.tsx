import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import { normalizeLiveState } from "../../shared/normalize";
import { OverlayRenderer, resolveMomentFrame } from "./OverlayRenderer";
import type { StoredAsset, ThemeDefinition } from "../../shared/theme";

const winnerText = "TEST WINNER LABEL 739";

function renderFinishedMatch(gameFinishedEnabled: boolean, winnerEnabled: boolean, scores = [2, 1], adjust?: (theme: ThemeDefinition) => void) {
  const theme = structuredClone(builtinThemes[0]);
  adjust?.(theme);
  theme.momentOverlays.gameFinished.enabled = gameFinishedEnabled;
  theme.teamEventOverlay.general.enabled = true;
  theme.teamEventOverlay.winner.enabled = winnerEnabled;
  theme.teamEventOverlay.winner.text = winnerText;

  const live = normalizeLiveState(
    {
      state: "END",
      period: "BREAK",
      round: 5,
      mainGame: [
        { name: "Left Team", score: scores[0] },
        { name: "Right Team", score: scores[1] }
      ]
    },
    { sourceStatus: "ok", fetchedAt: "2026-08-19T05:00:00.000Z", errorMessage: null }
  );

  return renderToStaticMarkup(<OverlayRenderer theme={theme} live={live} />);
}

describe("finished-match overlays", () => {
  it.each([
    { gameFinishedEnabled: true, winnerEnabled: true, showsGameFinished: true, showsWinner: true },
    { gameFinishedEnabled: false, winnerEnabled: true, showsGameFinished: false, showsWinner: true },
    { gameFinishedEnabled: true, winnerEnabled: false, showsGameFinished: true, showsWinner: false },
    { gameFinishedEnabled: false, winnerEnabled: false, showsGameFinished: false, showsWinner: false }
  ])(
    "keeps game-finished=$gameFinishedEnabled and winner=$winnerEnabled independent",
    ({ gameFinishedEnabled, winnerEnabled, showsGameFinished, showsWinner }) => {
      const markup = renderFinishedMatch(gameFinishedEnabled, winnerEnabled);

      expect(markup.includes("GAME FINISHED")).toBe(showsGameFinished);
      expect(markup.includes(winnerText)).toBe(showsWinner);
    }
  );

  it("does not show a winner for a tied completed match", () => {
    const markup = renderFinishedMatch(true, true, [1, 1]);

    expect(markup).toContain("GAME FINISHED");
    expect(markup).not.toContain(winnerText);
  });
});

function styleOf(markup: string, marker: string) {
  const start = markup.lastIndexOf("<", markup.indexOf(marker));
  return markup.slice(start, markup.indexOf(">", start));
}

describe("game finished card", () => {
  it("sits inside the centre line's border, in the line's stacking, and clears the break clock", () => {
    const markup = renderFinishedMatch(true, false, [2, 1], (theme) => {
      Object.assign(theme.components.breakTime, { x: 100, y: 50, width: 200, height: 40, borderWidth: 3, borderRadius: [8, 8, 2, 2], zIndex: 7 });
      Object.assign(theme.centerSecondary, { breakMode: "staticText", breakText: "BREAK LINE 551" });
    });
    const card = styleOf(markup, 'data-moment="gameFinished"');
    expect(card).toContain("left:103px;top:53px;width:194px;height:34px");
    expect(card).toContain("z-index:7");
    expect(card).toContain("border-radius:5px 5px 0px 0px");
    expect(markup).not.toContain("BREAK LINE 551");
  });

  it("keeps the centre line box showing when breaks would hide it", () => {
    const markup = renderFinishedMatch(true, false, [2, 1], (theme) => {
      theme.centerSecondary.breakMode = "hidden";
    });
    expect(markup).toContain("GAME FINISHED");
  });

  it("is not shown when the centre line it follows is hidden", () => {
    const markup = renderFinishedMatch(true, false, [2, 1], (theme) => {
      theme.components.breakTime.visible = false;
    });
    expect(markup).not.toContain("GAME FINISHED");
  });

  it("can sit freely, above every piece, with its own text", () => {
    const markup = renderFinishedMatch(true, false, [2, 1], (theme) => {
      Object.assign(theme.momentOverlays.gameFinished, { placement: "free", x: 10, y: 20, width: 300, height: 60, text: "FINAL", hideCentreLineContent: false });
      theme.components.breakTime.visible = false;
    });
    const card = styleOf(markup, 'data-moment="gameFinished"');
    expect(card).toContain("left:10px;top:20px;width:300px;height:60px");
    expect(markup).toContain("FINAL");
    expect(markup).not.toContain("GAME FINISHED");
  });

  it("leaves the break clock showing when it is not set to hide it", () => {
    const markup = renderFinishedMatch(true, false, [2, 1], (theme) => {
      Object.assign(theme.momentOverlays.gameFinished, { placement: "free", hideCentreLineContent: false });
      Object.assign(theme.centerSecondary, { breakMode: "staticText", breakText: "BREAK LINE 551" });
    });
    expect(markup).toContain("BREAK LINE 551");
  });
});

describe("moment card frame", () => {
  it("follows the centre line only while it is shown", () => {
    const theme = structuredClone(builtinThemes[0]);
    expect(resolveMomentFrame("timeout", theme, false)).toBeNull();
    const line = theme.components.breakTime;
    expect(resolveMomentFrame("timeout", theme, true)).toMatchObject({ following: true, x: line.x + line.borderWidth });
    theme.momentOverlays.timeout.placement = "free";
    theme.momentOverlays.timeout.x = 42;
    expect(resolveMomentFrame("timeout", theme, false)).toMatchObject({ following: false, x: 42 });
  });
});

describe("visible-pixel image rendering", () => {
  const asset: StoredAsset = {
    id: "asset-logo",
    originalName: "logo.png",
    mimeType: "image/png",
    url: "/uploads/logo.png",
    createdAt: "2026-08-19T05:00:00.000Z",
    role: "original",
    sourceAssetId: null,
    hiddenFromPicker: false,
    contentHash: "logo-hash",
    displayName: null,
    updatedAt: null,
    byteSize: null,
    visibleContent: {
      analyzerVersion: 1,
      status: "ready",
      sourceWidth: 100,
      sourceHeight: 80,
      x: 10,
      y: 20,
      width: 40,
      height: 20,
      alphaThreshold: 8
    }
  };

  it("uses analyzed bounds when a component enables visible-pixel fitting", () => {
    const theme = structuredClone(builtinThemes[0]);
    theme.components.eventLogo.visible = true;
    theme.components.eventLogo.assetId = asset.id;
    theme.components.eventLogo.backgroundImageFit = "contain";
    theme.components.eventLogo.imageContentMode = "visible-pixels";

    const markup = renderToStaticMarkup(<OverlayRenderer theme={theme} live={null} assets={[asset]} />);

    expect(markup).toContain('data-visible-content="true"');
    expect(markup).toContain('viewBox="10 20 40 20"');
    expect(markup).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("keeps the original img path when visible-pixel fitting is disabled", () => {
    const theme = structuredClone(builtinThemes[0]);
    theme.components.eventLogo.visible = true;
    theme.components.eventLogo.assetId = asset.id;
    theme.components.eventLogo.imageContentMode = "full-canvas";

    const markup = renderToStaticMarkup(<OverlayRenderer theme={theme} live={null} assets={[asset]} />);

    expect(markup).toContain('<img alt="logo.png"');
    expect(markup).not.toContain('data-visible-content="true"');
  });
});
