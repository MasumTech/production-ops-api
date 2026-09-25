import {
  formatClockMinutes,
  scheduleDateTimeToShiftMinutes,
  timeBuckets,
  type ShiftWindow,
} from "../shiftTiming";
import type { DailyPlanBlock, HourlyOutput, ShiftRecord } from "../types";

export interface PlanHour {
  startMinutes: number;
  endMinutes: number;
  label: string;
  target: number | null;
  dueNow: number | null;
  done: number | null;
  breakMinutes: number;
  future: boolean;
  current: boolean;
}

function unitsDuring(
  blocks: DailyPlanBlock[],
  window: ShiftWindow,
  from: number,
  to: number,
): number {
  return blocks.reduce((total, block) => {
    if (block.block_type !== "production" || !block.target_units_per_hour) {
      return total;
    }
    const start = scheduleDateTimeToShiftMinutes(block.planned_start_at, window);
    const end = scheduleDateTimeToShiftMinutes(block.planned_end_at, window);
    return total + Math.max(0, Math.min(to, end) - Math.max(from, start))
      * block.target_units_per_hour / 60;
  }, 0);
}

export function expectedUnitsNow(
  blocks: DailyPlanBlock[],
  window: ShiftWindow,
  plannedOutput: number,
  snapshotMinutes: number,
): number | null {
  const total = unitsDuring(blocks, window, window.startMinutes, window.endMinutes);
  if (!total || !plannedOutput) return null;
  const current = Math.max(window.startMinutes, Math.min(window.endMinutes, snapshotMinutes));
  return Math.round(plannedOutput *
    unitsDuring(blocks, window, window.startMinutes, current) / total);
}

export function completedFractionForBlock(
  block: DailyPlanBlock,
  blocks: DailyPlanBlock[],
  window: ShiftWindow,
  shift?: ShiftRecord,
): number {
  if (block.block_type !== "production" || !shift?.planned_output) return 0;
  const total = unitsDuring(blocks, window, window.startMinutes, window.endMinutes);
  const start = scheduleDateTimeToShiftMinutes(block.planned_start_at, window);
  const end = scheduleDateTimeToShiftMinutes(block.planned_end_at, window);
  const blockUnits = unitsDuring([block], window, start, end);
  if (!total || !blockUnits) return 0;
  const alreadyPlanned = unitsDuring(blocks, window, window.startMinutes, start);
  return Math.max(0, Math.min(100,
    (shift.actual_output / shift.planned_output * total - alreadyPlanned)
    / blockUnits * 100));
}

export function hourlyPlan(
  blocks: DailyPlanBlock[],
  outputs: HourlyOutput[],
  window: ShiftWindow,
  shift: ShiftRecord | undefined,
  snapshotMinutes: number,
): PlanHour[] {
  const total = unitsDuring(blocks, window, window.startMinutes, window.endMinutes);
  const planned = shift?.planned_output ?? 0;
  const available = planned > 0 && total > 0;
  return timeBuckets(window).map((bucket) => {
    const from = bucket.startMinutes;
    const to = bucket.endMinutes;
    const future = snapshotMinutes <= from;
    const dueUntil = Math.max(from, Math.min(to, snapshotMinutes));
    const base = expectedUnitsNow(blocks, window, planned, from);
    const full = expectedUnitsNow(blocks, window, planned, to);
    const due = expectedUnitsNow(blocks, window, planned, dueUntil);
    const output = outputs.find((item) =>
      scheduleDateTimeToShiftMinutes(item.hour_start_at, window) ===
      Math.floor(from / 60) * 60,
    );
    const breakMinutes = blocks.reduce((sum, block) => {
      if (block.block_type !== "break") return sum;
      const start = scheduleDateTimeToShiftMinutes(block.planned_start_at, window);
      const end = scheduleDateTimeToShiftMinutes(block.planned_end_at, window);
      return sum + Math.max(0, Math.min(to, end) - Math.max(from, start));
    }, 0);
    return {
      startMinutes: from,
      endMinutes: to,
      label: `${formatClockMinutes(from)}–${formatClockMinutes(to)}`,
      target: available && base !== null && full !== null ? full - base : null,
      dueNow: available && !future && base !== null && due !== null ? due - base : null,
      done: !future && output ? output.actual_units : null,
      breakMinutes,
      future,
      current: !future && snapshotMinutes < to,
    };
  });
}
