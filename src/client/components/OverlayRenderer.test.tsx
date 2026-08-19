import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { builtinThemes } from "../../shared/builtinThemes";
import { normalizeLiveState } from "../../shared/normalize";
import { OverlayRenderer } from "./OverlayRenderer";

const winnerText = "TEST WINNER LABEL 739";

function renderFinishedMatch(gameFinishedEnabled: boolean, winnerEnabled: boolean, scores = [2, 1]) {
  const theme = structuredClone(builtinThemes[0]);
  theme.centerSecondary.gameFinished.enabled = gameFinishedEnabled;
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
