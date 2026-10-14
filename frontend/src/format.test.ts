import { describe, expect, it } from "vitest";

import { isCurrentOperationalDate } from "./format";

describe("isCurrentOperationalDate", () => {
  it("keeps the previous night shift editable until 07:00", () => {
    const afterMidnight = new Date(2026, 9, 15, 3, 30);

    expect(isCurrentOperationalDate("2026-10-14", "night", afterMidnight)).toBe(true);
    expect(isCurrentOperationalDate("2026-10-14", "day", afterMidnight)).toBe(false);
  });

  it("makes the previous night read-only after shift end", () => {
    const afterShift = new Date(2026, 9, 15, 8);

    expect(isCurrentOperationalDate("2026-10-14", "night", afterShift)).toBe(false);
  });
});
