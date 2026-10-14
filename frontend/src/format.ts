export function formatDateTime(value: string | null): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function toIso(localValue: string): string | null {
  if (!localValue) return null;
  const value = new Date(localValue);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function isCurrentOperationalDate(
  operationalDate: string,
  shiftType: "day" | "night",
  now = new Date(),
): boolean {
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  if (operationalDate === today) return true;
  if (shiftType !== "night" || now.getHours() >= 7) return false;
  const previousDay = new Date(`${today}T12:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  return operationalDate === previousDay.toISOString().slice(0, 10);
}
