import type { ShiftRecord } from "./types";

export interface ShiftWindow {
  startMinutes: number;
  endMinutes: number;
  startLabel: string;
  endLabel: string;
}

export interface TimeBucket {
  startMinutes: number;
  endMinutes: number;
  label: string;
}

export function clockToMinutes(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  return hour * 60 + minute;
}

export function formatClockMinutes(value: number): string {
  const normalized = ((value % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function getShiftWindow(
  operationalDate: string,
  shifts: ShiftRecord[],
  shiftType: "day" | "night" = "day",
): ShiftWindow {
  const weekend = [0, 6].includes(
    new Date(`${operationalDate}T12:00:00`).getDay(),
  );
  const defaultStart =
    shiftType === "day" ? (weekend ? 7 * 60 : 6 * 60 + 45) : 23 * 60;
  const defaultEnd = shiftType === "day" ? 18 * 60 : 7 * 60;
  const record = shifts.find(
    (shift) => shift.date === operationalDate && shift.shift_type === shiftType,
  );
  const startMinutes = clockToMinutes(record?.start_time, defaultStart);
  let endMinutes = clockToMinutes(record?.end_time, defaultEnd);
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return {
    startMinutes,
    endMinutes,
    startLabel: formatClockMinutes(startMinutes),
    endLabel: formatClockMinutes(endMinutes),
  };
}

export function dateTimeToShiftMinutes(value: string, window: ShiftWindow): number {
  const date = new Date(value);
  let minutes = date.getHours() * 60 + date.getMinutes();
  if (window.endMinutes > 24 * 60 && minutes < window.startMinutes) {
    minutes += 24 * 60;
  }
  return minutes;
}

export function scheduleDateTimeToShiftMinutes(
  value: string,
  window: ShiftWindow,
): number {
  const date = new Date(value);
  let minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (window.endMinutes > 24 * 60 && minutes < window.startMinutes) {
    minutes += 24 * 60;
  }
  return minutes;
}

export function formatScheduleClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatClockMinutes(date.getUTCHours() * 60 + date.getUTCMinutes());
}

export function timelineStyle(
  start: string,
  end: string,
  window: ShiftWindow,
): { left: string; width: string } {
  const shiftDuration = Math.max(1, window.endMinutes - window.startMinutes);
  const startMinute = Math.max(
    window.startMinutes,
    scheduleDateTimeToShiftMinutes(start, window),
  );
  const endMinute = Math.min(
    window.endMinutes,
    scheduleDateTimeToShiftMinutes(end, window),
  );
  return {
    left: `${((startMinute - window.startMinutes) / shiftDuration) * 100}%`,
    width: `${(Math.max(0, endMinute - startMinute) / shiftDuration) * 100}%`,
  };
}

export function timelineTicks(window: ShiftWindow): number[] {
  const ticks = [window.startMinutes];
  let next = Math.ceil(window.startMinutes / 60) * 60;
  if (next === window.startMinutes) next += 60;
  while (next < window.endMinutes) {
    ticks.push(next);
    next += 60;
  }
  if (ticks.at(-1) !== window.endMinutes) ticks.push(window.endMinutes);
  return ticks;
}

export function timeBuckets(window: ShiftWindow): TimeBucket[] {
  const points = timelineTicks(window);
  return points.slice(0, -1).map((startMinutes, index) => {
    const endMinutes = points[index + 1];
    return {
      startMinutes,
      endMinutes,
      label: `${formatClockMinutes(startMinutes)}–${formatClockMinutes(endMinutes)}`,
    };
  });
}

export function elapsedShiftFraction(
  window: ShiftWindow,
  now = new Date(),
): number {
  let current = now.getHours() * 60 + now.getMinutes();
  if (window.endMinutes > 24 * 60 && current < window.startMinutes) {
    current += 24 * 60;
  }
  return Math.min(
    1,
    Math.max(
      0,
      (current - window.startMinutes) /
        Math.max(1, window.endMinutes - window.startMinutes),
    ),
  );
}
