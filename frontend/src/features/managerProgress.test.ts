import { describe, expect, it } from "vitest";
import type { DailyPlanBlock } from "../types";
import type { ShiftWindow } from "../shiftTiming";
import { calculateTimePosition } from "./managerProgress";

const window: ShiftWindow = {
  startMinutes: 6 * 60 + 45,
  endMinutes: 18 * 60,
  startLabel: "06:45",
  endLabel: "18:00",
};

function block(
  id: number,
  type: "production" | "break",
  start: string,
  end: string,
): DailyPlanBlock {
  return {
    id,
    assignment: 1,
    assignment_date: "2026-09-04",
    production_line: 1,
    production_line_code: "DEMO-LINE-01",
    sequence_number: id,
    block_type: type,
    planned_start_at: `2026-09-04T${start}:00+01:00`,
    planned_end_at: `2026-09-04T${end}:00+01:00`,
    product_code: type === "production" ? `P-${id}` : "",
    product_name: type === "production" ? `Product ${id}` : "",
    target_units_per_hour: type === "production" ? 840 : null,
    planned_units: type === "production" ? 2800 : 0,
    break_number: type === "break" ? id : null,
  };
}

const blocks = [
  block(1, "production", "06:45", "10:00"),
  block(2, "break", "10:00", "10:40"),
  block(3, "production", "10:40", "14:00"),
  block(4, "break", "14:00", "14:40"),
  block(5, "production", "14:40", "18:00"),
];

describe("calculateTimePosition", () => {
  it("converts a unit shortfall into break-aware minutes and full-shift attainment", () => {
    expect(calculateTimePosition(-560, 8400, blocks, window)).toEqual({
      positionMinutes: -40,
      shiftAttainment: 94,
    });
  });

  it("caps attainment at 100 percent when the line is ahead", () => {
    expect(calculateTimePosition(140, 8400, blocks, window)).toEqual({
      positionMinutes: 10,
      shiftAttainment: 100,
    });
  });

  it("does not invent time metrics without a production plan", () => {
    expect(calculateTimePosition(-100, 8400, [], window)).toBeNull();
    expect(calculateTimePosition(null, 8400, blocks, window)).toBeNull();
  });
});
