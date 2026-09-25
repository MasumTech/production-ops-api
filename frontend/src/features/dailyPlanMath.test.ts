import { describe, expect, it } from "vitest";
import type { DailyPlanBlock, HourlyOutput, ShiftRecord } from "../types";
import { formatScheduleClock, scheduleDateTimeToShiftMinutes } from "../shiftTiming";
import { completedFractionForBlock, expectedUnitsNow, hourlyPlan } from "./dailyPlanMath";

const window = { startMinutes: 420, endMinutes: 660, startLabel: "07:00", endLabel: "11:00" };
const base = { assignment: 1, assignment_date: "2026-09-25", production_line: 1, production_line_code: "LINE-1", product_code: "A", product_name: "Product A", planned_units: 0, break_number: null };
const blocks: DailyPlanBlock[] = [
  { ...base, id: 1, sequence_number: 1, block_type: "production", planned_start_at: "2026-09-25T07:00:00Z", planned_end_at: "2026-09-25T09:00:00Z", target_units_per_hour: 100 },
  { ...base, id: 2, sequence_number: 2, block_type: "break", planned_start_at: "2026-09-25T09:00:00Z", planned_end_at: "2026-09-25T09:40:00Z", target_units_per_hour: null, break_number: 1 },
  { ...base, id: 3, sequence_number: 3, block_type: "production", planned_start_at: "2026-09-25T09:40:00Z", planned_end_at: "2026-09-25T11:00:00Z", target_units_per_hour: 100 },
];
const shift = { planned_output: 340, actual_output: 170 } as ShiftRecord;

describe("Daily Plan output curve", () => {
  it("keeps the site's scheduled break time through British summer time", () => {
    const start = "2026-09-25T10:08:00+01:00";
    expect(formatScheduleClock(start)).toBe("10:08");
    expect(scheduleDateTimeToShiftMinutes(start, window)).toBe(608);
  });
  it("excludes protected breaks from targets and maps completed units across production blocks", () => {
    expect(expectedUnitsNow(blocks, window, shift.planned_output, 550)).toBe(204);
    expect(expectedUnitsNow(blocks, window, shift.planned_output, 610)).toBe(255);
    expect(completedFractionForBlock(blocks[0], blocks, window, shift)).toBeCloseTo(83.33, 2);
    expect(completedFractionForBlock(blocks[2], blocks, window, shift)).toBe(0);
  });

  it("shows shortages only where hourly actuals exist and the hour is due", () => {
    const outputs: HourlyOutput[] = [{ id: 1, assignment: 1, hour_start_at: "2026-09-25T09:00:00+01:00", actual_units: 12, updated_at: "2026-09-25T09:59:00+01:00" }];
    const hours = hourlyPlan(blocks, outputs, window, shift, 610);
    expect(hours[2]).toMatchObject({ label: "09:00–10:00", breakMinutes: 40, target: 34, done: 12, dueNow: 34 });
    expect(hours[3]).toMatchObject({ label: "10:00–11:00", current: true, done: null, dueNow: 17 });
  });
});
