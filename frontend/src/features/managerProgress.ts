import { expectedUnitsNow, hourlyPlan, type PlanHour } from "./dailyPlanMath";
import {
  dateTimeToShiftMinutes,
  scheduleDateTimeToShiftMinutes,
  type ShiftWindow,
} from "../shiftTiming";
import type { DailyPlanBlock, HourlyOutput, LineUpdate } from "../types";
import type { ManagerLineRow } from "./ManagerConsole";

export interface ManagerLineProgress {
  row: ManagerLineRow;
  expectedNow: number | null;
  actual: number | null;
  delta: number | null;
  positionMinutes: number | null;
  shiftAttainment: number | null;
  hours: PlanHour[];
  blocks: DailyPlanBlock[];
}

export function calculateTimePosition(
  deltaUnits: number | null,
  plannedOutput: number,
  blocks: DailyPlanBlock[],
  window: ShiftWindow,
): { positionMinutes: number; shiftAttainment: number } | null {
  if (deltaUnits === null || plannedOutput <= 0) return null;
  const productiveMinutes = blocks.reduce((total, block) => {
    if (block.block_type !== "production") return total;
    const start = Math.max(
      window.startMinutes,
      scheduleDateTimeToShiftMinutes(block.planned_start_at, window),
    );
    const end = Math.min(
      window.endMinutes,
      scheduleDateTimeToShiftMinutes(block.planned_end_at, window),
    );
    return total + Math.max(0, end - start);
  }, 0);
  if (!productiveMinutes) return null;

  const positionMinutes = Math.round(deltaUnits / plannedOutput * productiveMinutes);
  const shiftMinutes = Math.max(1, window.endMinutes - window.startMinutes);
  const shiftAttainment = Math.max(
    0,
    Math.min(100, Math.round(100 + positionMinutes / shiftMinutes * 100)),
  );
  return { positionMinutes, shiftAttainment };
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
    const delta = expectedNow === null || actual === null ? null : actual - expectedNow;
    const timePosition = calculateTimePosition(
      delta,
      shift?.planned_output ?? 0,
      blocks,
      window,
    );
    return {
      row,
      expectedNow,
      actual,
      delta,
      positionMinutes: timePosition?.positionMinutes ?? null,
      shiftAttainment: timePosition?.shiftAttainment ?? null,
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
  shiftAttainment: number;
} | null {
  if (!lines.length || lines.some((line) =>
    line.expectedNow === null || line.actual === null || line.shiftAttainment === null
  )) {
    return null;
  }
  const actual = lines.reduce((sum, line) => sum + (line.actual ?? 0), 0);
  const due = lines.reduce((sum, line) => sum + (line.expectedNow ?? 0), 0);
  const shiftAttainment = Math.round(
    lines.reduce((sum, line) => sum + (line.shiftAttainment ?? 0), 0) / lines.length,
  );
  return { actual, due, delta: actual - due, shiftAttainment };
}
