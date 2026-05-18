import { describe, expect, it } from "vitest";
import { operationsStateSchema } from "./theme";

describe("operationsStateSchema", () => {
  it("migrates legacy side-based overrides to normalized-name overrides", () => {
    const parsed = operationsStateSchema.parse({
      overrides: {
        left: {
          side: "left",
          rawInputName: "BANDIT",
          teamId: "team-bandit",
          createdAt: "2026-05-18T10:27:14.087Z",
          updatedAt: "2026-05-18T10:27:14.087Z"
        },
        right: {
          side: "right",
          rawInputName: "PROJECT",
          teamId: "team-project",
          createdAt: "2026-05-18T10:27:12.226Z",
          updatedAt: "2026-05-18T10:27:12.226Z"
        }
      }
    });

    expect(parsed.overrides).toEqual([
      {
        normalizedInputName: "BANDIT",
        rawInputName: "BANDIT",
        teamId: "team-bandit",
        createdAt: "2026-05-18T10:27:14.087Z",
        updatedAt: "2026-05-18T10:27:14.087Z"
      },
      {
        normalizedInputName: "PROJECT",
        rawInputName: "PROJECT",
        teamId: "team-project",
        createdAt: "2026-05-18T10:27:12.226Z",
        updatedAt: "2026-05-18T10:27:12.226Z"
      }
    ]);
  });

  it("keeps the new override array format unchanged", () => {
    const parsed = operationsStateSchema.parse({
      overrides: [
        {
          normalizedInputName: "SBJ",
          rawInputName: "SBJ",
          teamId: "team-sbj",
          createdAt: "2026-05-18T10:27:14.087Z",
          updatedAt: "2026-05-18T10:27:14.087Z"
        }
      ]
    });

    expect(parsed.overrides).toHaveLength(1);
    expect(parsed.overrides[0]?.normalizedInputName).toBe("SBJ");
  });
});
