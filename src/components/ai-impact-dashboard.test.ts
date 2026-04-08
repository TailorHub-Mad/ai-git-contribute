import { describe, expect, it } from "vitest";

import { formatSelectedPeriodLabel } from "./ai-impact-dashboard";

describe("formatSelectedPeriodLabel", () => {
  it("formats the actual selected date range instead of grouped bucket anchors", () => {
    expect(formatSelectedPeriodLabel("2025-04-08", "2026-04-07")).toBe(
      "Apr 8, 2025 - Apr 7, 2026",
    );
  });

  it("returns a fallback when range metadata is missing", () => {
    expect(formatSelectedPeriodLabel(null, "2026-04-07")).toBe("No period data");
  });
});
