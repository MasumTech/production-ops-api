import { expectedUnitsNow, hourlyPlan, type PlanHour } from "./dailyPlanMath";
import { dateTimeToShiftMinutes, type ShiftWindow } from "../shiftTiming";
import type { DailyPlanBlock, HourlyOutput, LineUpdate } from "../types";
import type { ManagerLineRow } from "./ManagerConsole";

export interface ManagerLineProgress {
  row: ManagerLineRow;
  expectedNow: number | null;
  actual: number | null;
  delta: number | null;
  hours: PlanHour[];
  blocks: DailyPlanBlock[];
}

export function managerSnapshotMinutes(
  updates: LineUpdate[],
  rows: ManagerLineRow[],
  window: ShiftWindow,
  live: boolean,
  now = new Date(),
): number {
  if (live) return dateTimeToShiftMinutes(now.toISOString(), window);

  const assignmentIds = new Set(rows.map((row) => row.assignment.id));
  const latest = updates
    .filter((update) => assignmentIds.has(update.assignment))
    .map((update) => new Date(update.recorded_at))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0];
  return latest
    ? dateTimeToShiftMinutes(latest.toISOString(), window)
    : window.endMinutes;
}

export function buildManagerProgress(
  rows: ManagerLineRow[],
  planBlocks: DailyPlanBlock[],
  outputs: HourlyOutput[],
  window: ShiftWindow,
  snapshotMinutes: number,
): ManagerLineProgress[] {
  return rows.map((row) => {
    const blocks = planBlocks.filter((block) => block.assignment === row.assignment.id);
    const shift = row.shift ?? undefined;
    const actual = shift ? shift.actual_output : null;
    const expectedNow = expectedUnitsNow(
      blocks,
      window,
      shift?.planned_output ?? 0,
      snapshotMinutes,
    );
    return {
      row,
      expectedNow,
      actual,
      delta: expectedNow === null || actual === null ? null : actual - expectedNow,
      blocks,
      hours: hourlyPlan(
        blocks,
        outputs.filter((output) => output.assignment === row.assignment.id),
        window,
        shift,
        snapshotMinutes,
      ),
    };
  });
}

export function aggregateManagerPosition(lines: ManagerLineProgress[]): {
  actual: number;
  due: number;
  delta: number;
} | null {
  if (!lines.length || lines.some((line) => line.expectedNow === null || line.actual === null)) {
    return null;
  }
  const actual = lines.reduce((sum, line) => sum + (line.actual ?? 0), 0);
  const due = lines.reduce((sum, line) => sum + (line.expectedNow ?? 0), 0);
  return { actual, due, delta: actual - due };
}
