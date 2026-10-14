import { useMemo, useState, type CSSProperties, type FormEvent } from "react";

import { AppIcon } from "../AppIcon";
import { ApiError, apiRequest } from "../api";
import { EmptyState } from "../components";
import {
  HourlyOutputEditor,
  type HourlyOutputContext,
} from "../HourlyOutputEditor";
import {
  dateTimeToShiftMinutes,
  formatClockMinutes,
  formatScheduleClock,
  getShiftWindow,
  timelineStyle,
  timelineTicks,
} from "../shiftTiming";
import type {
  Assignment,
  DailyPlanBlock,
  DowntimeEvent,
  HourlyOutput,
  LineUpdate,
  ShiftRecord,
} from "../types";
import { completedFractionForBlock, expectedUnitsNow, hourlyPlan, type PlanHour } from "./dailyPlanMath";

const NUMBER = new Intl.NumberFormat("en-GB");

type SequenceView = "products" | "schedule";

function shortTime(value: string): string {
  return formatScheduleClock(value);
}

function displayLine(code: string): string {
  const match = code.match(/(\d+)$/);
  return match ? `Line ${Number(match[1])}` : code;
}

function latestUpdate(
  updates: LineUpdate[],
  assignmentId: number,
): LineUpdate | undefined {
  return updates
    .filter((update) => update.assignment === assignmentId)
    .sort(
      (left, right) =>
        new Date(right.recorded_at).getTime() -
        new Date(left.recorded_at).getTime(),
    )[0];
}

function lineShift(
  shifts: ShiftRecord[],
  assignment: Assignment,
): ShiftRecord | undefined {
  return shifts.find(
    (shift) =>
      shift.production_line === assignment.production_line &&
      shift.date === assignment.date &&
      shift.shift_type === assignment.shift_type,
  );
}

function completionPercentage(shift: ShiftRecord | undefined): number {
  if (!shift?.planned_output) return 0;
  return Math.round((shift.actual_output / shift.planned_output) * 100);
}

function localDateTimeForMinute(operationalDate: string, minutes: number): string {
  const dayOffset = Math.floor(minutes / (24 * 60));
  const date = new Date(`${operationalDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return `${date.toISOString().slice(0, 10)}T${formatClockMinutes(minutes)}`;
}

type SelectedDowntimeHour = {
  assignment: Assignment;
  shift: ShiftRecord;
  hour: PlanHour;
};

export function DailyPlanPanel({
  assignments,
  planBlocks,
  hourlyOutputs = [],
  shifts = [],
  updates = [],
  downtimeEvents = [],
  live = false,
  onRequestPlanChange,
  onSaved,
}: {
  assignments: Assignment[];
  planBlocks: DailyPlanBlock[];
  hourlyOutputs?: HourlyOutput[];
  shifts?: ShiftRecord[];
  updates?: LineUpdate[];
  downtimeEvents?: DowntimeEvent[];
  live?: boolean;
  onRequestPlanChange?: (assignmentId: number) => void;
  onSaved?: (message: string) => Promise<void> | void;
}) {
  const visibleAssignments = assignments;
  const operationalDate =
    visibleAssignments[0]?.date ?? new Date().toISOString().slice(0, 10);
  const window = getShiftWindow(operationalDate, shifts, "day");
  const [lineFilter, setLineFilter] = useState("all");
  const [sequenceView, setSequenceView] =
    useState<SequenceView>("products");
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [selectedOutputHour, setSelectedOutputHour] =
    useState<HourlyOutputContext | null>(null);
  const [selectedDowntimeHour, setSelectedDowntimeHour] = useState<SelectedDowntimeHour | null>(null);
  const [editingDowntimeId, setEditingDowntimeId] = useState<number | null>(null);
  const [downtimeStartedAt, setDowntimeStartedAt] = useState("");
  const [downtimeEndedAt, setDowntimeEndedAt] = useState("");
  const [downtimeReason, setDowntimeReason] = useState<DowntimeEvent["reason_category"]>("equipment");
  const [downtimeOwner, setDowntimeOwner] = useState<DowntimeEvent["owner_group"]>("engineering");
  const [downtimeStatus, setDowntimeStatus] = useState<DowntimeEvent["status"]>("resolved");
  const [downtimeDescription, setDowntimeDescription] = useState("");
  const [downtimeResolution, setDowntimeResolution] = useState("");
  const [downtimeSaving, setDowntimeSaving] = useState(false);
  const [downtimeMessage, setDowntimeMessage] = useState("");
  const [deleteDowntimeId, setDeleteDowntimeId] = useState<number | null>(null);
  const [publicationSaving, setPublicationSaving] = useState<number | null>(null);
  const [publicationMessage, setPublicationMessage] = useState("");
  const [selectedProductBlock, setSelectedProductBlock] = useState<DailyPlanBlock | null>(null);
  const [completedUnits, setCompletedUnits] = useState("");
  const [shortReason, setShortReason] = useState<DailyPlanBlock["short_reason"]>("");
  const [completionNote, setCompletionNote] = useState("");
  const [completionSaving, setCompletionSaving] = useState(false);
  const [completionMessage, setCompletionMessage] = useState("");

  const eventsForHour = (selected: SelectedDowntimeHour): DowntimeEvent[] =>
    downtimeEvents.filter((event) => {
      if (event.shift !== selected.shift.id) return false;
      const started = dateTimeToShiftMinutes(event.started_at, window);
      const ended = event.ended_at
        ? dateTimeToShiftMinutes(event.ended_at, window)
        : selected.hour.endMinutes;
      return started < selected.hour.endMinutes && ended > selected.hour.startMinutes;
    });

  const downtimeMinutesForHour = (shift: ShiftRecord | undefined, hour: PlanHour): number => {
    if (!shift) return 0;
    return downtimeEvents
      .filter((event) => event.shift === shift.id)
      .reduce((total, event) => {
        const started = dateTimeToShiftMinutes(event.started_at, window);
        const ended = event.ended_at
          ? dateTimeToShiftMinutes(event.ended_at, window)
          : hour.endMinutes;
        return total + Math.max(0, Math.min(hour.endMinutes, ended) - Math.max(hour.startMinutes, started));
      }, 0);
  };

  const resetDowntimeForm = (selected: SelectedDowntimeHour) => {
    const defaultEnd = Math.min(selected.hour.endMinutes, selected.hour.startMinutes + 10);
    setEditingDowntimeId(null);
    setDowntimeStartedAt(localDateTimeForMinute(operationalDate, selected.hour.startMinutes));
    setDowntimeEndedAt(localDateTimeForMinute(operationalDate, defaultEnd));
    setDowntimeReason("equipment");
    setDowntimeOwner("engineering");
    setDowntimeStatus("resolved");
    setDowntimeDescription("");
    setDowntimeResolution("");
    setDowntimeMessage("");
    setDeleteDowntimeId(null);
  };

  const openDowntimeHour = (assignment: Assignment, shift: ShiftRecord, hour: PlanHour) => {
    const selected = { assignment, shift, hour };
    setSelectedDowntimeHour(selected);
    resetDowntimeForm(selected);
  };

  const openOutputHour = (assignment: Assignment, hour: PlanHour) => {
    const clockHour = Math.floor(hour.startMinutes / 60) * 60;
    const shift = lineShift(shifts, assignment);
    const output = hourlyOutputs.find(
      (item) =>
        item.assignment === assignment.id &&
        dateTimeToShiftMinutes(item.hour_start_at, window) === clockHour,
    ) ?? null;
    const localHour = localDateTimeForMinute(operationalDate, clockHour);
    setSelectedOutputHour({
      assignmentId: assignment.id,
      lineLabel: displayLine(assignment.production_line_code),
      hourLabel: hour.label,
      hourStartAt: new Date(localHour).toISOString(),
      target: hour.target,
      downtimeMinutes: downtimeMinutesForHour(shift, hour),
      output,
    });
  };

  const editDowntime = (event: DowntimeEvent) => {
    setEditingDowntimeId(event.id);
    setDowntimeStartedAt(event.started_at.slice(0, 16));
    setDowntimeEndedAt(event.ended_at?.slice(0, 16) ?? "");
    setDowntimeReason(event.reason_category);
    setDowntimeOwner(event.owner_group);
    setDowntimeStatus(event.status);
    setDowntimeDescription(event.description);
    setDowntimeResolution(event.resolution_note);
    setDowntimeMessage("");
    setDeleteDowntimeId(null);
  };

  const saveDowntime = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!selectedDowntimeHour || !downtimeDescription.trim()) return;
    setDowntimeSaving(true);
    setDowntimeMessage("");
    try {
      await apiRequest(
        editingDowntimeId ? `/downtime-events/${editingDowntimeId}/` : "/downtime-events/",
        {
          method: editingDowntimeId ? "PATCH" : "POST",
          body: JSON.stringify({
            shift: selectedDowntimeHour.shift.id,
            started_at: new Date(downtimeStartedAt).toISOString(),
            ended_at: downtimeEndedAt ? new Date(downtimeEndedAt).toISOString() : null,
            reason_category: downtimeReason,
            description: downtimeDescription.trim(),
            owner_group: downtimeOwner,
            status: downtimeStatus,
            resolution_note: downtimeResolution.trim(),
          }),
        },
      );
      const message = editingDowntimeId ? "Hourly downtime updated." : "Hourly downtime added.";
      setDowntimeMessage(message);
      await onSaved?.(message);
      resetDowntimeForm(selectedDowntimeHour);
    } catch (caught) {
      setDowntimeMessage(caught instanceof ApiError ? caught.message : "Could not save downtime.");
    } finally {
      setDowntimeSaving(false);
    }
  };

  const removeDowntime = async (eventId: number) => {
    setDowntimeSaving(true);
    setDowntimeMessage("");
    try {
      await apiRequest(`/downtime-events/${eventId}/`, { method: "DELETE" });
      setDeleteDowntimeId(null);
      setDowntimeMessage("Hourly downtime deleted.");
      await onSaved?.("Hourly downtime deleted.");
      if (editingDowntimeId === eventId && selectedDowntimeHour) resetDowntimeForm(selectedDowntimeHour);
    } catch (caught) {
      setDowntimeMessage(caught instanceof ApiError ? caught.message : "Could not delete downtime.");
    } finally {
      setDowntimeSaving(false);
    }
  };

  const requestPublication = async (assignment: Assignment) => {
    setPublicationSaving(assignment.id);
    setPublicationMessage("");
    try {
      await apiRequest<Assignment>(
        `/team-leader-assignments/${assignment.id}/request-publication/`,
        { method: "POST" },
      );
      const message = `Publication requested for ${displayLine(assignment.production_line_code)}.`;
      setPublicationMessage(message);
      await onSaved?.(message);
    } catch (caught) {
      setPublicationMessage(
        caught instanceof ApiError ? caught.message : "Could not request publication.",
      );
    } finally {
      setPublicationSaving(null);
    }
  };

  const openProductCompletion = (block: DailyPlanBlock) => {
    setSelectedProductBlock(block);
    setCompletedUnits(String(block.actual_units ?? ""));
    setShortReason(block.short_reason ?? "");
    setCompletionNote(block.short_note ?? "");
    setCompletionMessage("");
  };

  const completeProduct = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!selectedProductBlock || completedUnits === "") return;
    const actualUnits = Number(completedUnits);
    const productShort = Math.max(0, selectedProductBlock.planned_units - actualUnits);
    if (productShort && !shortReason) {
      setCompletionMessage(
        `This product is ${NUMBER.format(productShort)} units short. Select a reason before completing the changeover.`,
      );
      return;
    }
    setCompletionSaving(true);
    setCompletionMessage("");
    try {
      await apiRequest<DailyPlanBlock>(
        `/daily-plan-blocks/${selectedProductBlock.id}/complete/`,
        {
          method: "POST",
          body: JSON.stringify({
            actual_units: actualUnits,
            short_reason: productShort ? shortReason : "target_completed",
            short_note: completionNote.trim(),
          }),
        },
      );
      const message = productShort
        ? `${NUMBER.format(productShort)} short units preserved for ${selectedProductBlock.product_name}.`
        : `${selectedProductBlock.product_name} completed to target.`;
      await onSaved?.(message);
      setSelectedProductBlock(null);
    } catch (caught) {
      setCompletionMessage(
        caught instanceof ApiError ? caught.message : "Could not record product completion.",
      );
    } finally {
      setCompletionSaving(false);
    }
  };

  const shownAssignments = useMemo(
    () =>
      lineFilter === "all"
        ? visibleAssignments
        : visibleAssignments.filter(
            (assignment) => String(assignment.id) === lineFilter,
          ),
    [lineFilter, visibleAssignments],
  );

  const ticks = timelineTicks(window);
  const snapshotAt = useMemo(() => {
    if (live) return new Date();

    const latestTimestamp = updates
      .filter((update) =>
        visibleAssignments.some(
          (assignment) => assignment.id === update.assignment,
        ),
      )
      .map((update) => new Date(update.recorded_at))
      .filter((value) => !Number.isNaN(value.getTime()))
      .sort((left, right) => right.getTime() - left.getTime())[0];

    if (latestTimestamp) return latestTimestamp;

    const fallback = new Date(
      `${operationalDate}T${formatClockMinutes(window.endMinutes)}:00`,
    );
    return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
  }, [
    live,
    operationalDate,
    updates,
    visibleAssignments,
    window.endMinutes,
  ]);

  const snapshotMinutes = dateTimeToShiftMinutes(
    snapshotAt.toISOString(),
    window,
  );
  const snapshotInsideShift =
    snapshotMinutes >= window.startMinutes &&
    snapshotMinutes <= window.endMinutes;
  const snapshotLeft = Math.min(
    100,
    Math.max(
      0,
      ((snapshotMinutes - window.startMinutes) /
        Math.max(1, window.endMinutes - window.startMinutes)) *
        100,
    ),
  );
  const snapshotLabel = `${live ? "Now" : "Snapshot"} ${formatClockMinutes(snapshotMinutes)}`;
  const planChangeAssignment =
    shownAssignments.find((assignment) => assignment.plan_status !== "draft")?.id
    ?? visibleAssignments.find((assignment) => assignment.plan_status !== "draft")?.id
    ?? null;

  return (
    <section className="tl-plan-v2">
      <header className="tl-plan-v2__hero">
        <div>
          <h1>Daily Plan</h1>
          <p>Assigned-line product schedule, targets and planned breaks</p>
        </div>
        {planChangeAssignment && onRequestPlanChange ? (
          <button
            type="button"
            className="tl-plan-v2__request"
            onClick={() => onRequestPlanChange(planChangeAssignment)}
          >
            Request plan change
          </button>
        ) : null}
      </header>

      {visibleAssignments.length === 0 ? (
        <EmptyState
          title="No assigned lines"
          body="The daily schedule will appear when Operations assigns a line for this date."
        />
      ) : (
        <>
          <div className="tl-plan-v2__controls">
            <select
              aria-label="Filter Daily Plan by assigned line"
              value={lineFilter}
              onChange={(event) => setLineFilter(event.target.value)}
            >
              <option value="all">All assigned lines</option>
              {visibleAssignments.map((assignment) => (
                <option value={assignment.id} key={assignment.id}>
                  {displayLine(assignment.production_line_code)}
                </option>
              ))}
            </select>

            <select
              aria-label="Daily Plan sequence view"
              value={sequenceView}
              onChange={(event) =>
                setSequenceView(event.target.value as SequenceView)
              }
            >
              <option value="products">Product sequence</option>
              <option value="schedule">Full schedule</option>
            </select>

            <span>
              {visibleAssignments.length} line
              {visibleAssignments.length === 1 ? "" : "s"} assigned
            </span>
          </div>

          <div className="tl-plan-publication-list" aria-label="Plan publication status">
            {shownAssignments.map((assignment) => {
              const isDraft = assignment.plan_status === "draft";
              return (
                <section className={`tl-plan-publication is-${isDraft ? "draft" : "published"}`} key={assignment.id}>
                  <div>
                    <strong>{displayLine(assignment.production_line_code)} · {isDraft ? "Plan awaiting Manager approval" : "Published and approved"}</strong>
                    <span>{isDraft ? "You can review this plan, but production and downtime updates are unavailable until it is published." : `Version ${assignment.plan_version ?? 1}${assignment.plan_published_by_username ? ` · Published by ${assignment.plan_published_by_username}` : ""}`}</span>
                  </div>
                  {isDraft ? (
                    <button
                      type="button"
                      disabled={publicationSaving === assignment.id || Boolean(assignment.plan_approval_requested_at)}
                      onClick={() => void requestPublication(assignment)}
                    >
                      {assignment.plan_approval_requested_at ? "Approval requested" : publicationSaving === assignment.id ? "Requesting…" : "Ask Manager to publish"}
                    </button>
                  ) : null}
                </section>
              );
            })}
          </div>
          {publicationMessage ? <p className="tl-plan-publication-message" role="status">{publicationMessage}</p> : null}

          <section
            className="tl-plan-v2__schedule"
            aria-label="Team Leader shift schedule"
          >
            <header>
              <h2>
                Shift schedule · {window.startLabel}–{window.endLabel}
              </h2>
              <div className="tl-plan-v2__legend" aria-label="Schedule legend">
                <span>
                  <i className="is-production" aria-hidden="true" />
                  Done
                </span>
                <span>
                  <i className="is-remaining" aria-hidden="true" />
                  Planned output left
                </span>
                <span>
                  <i className="is-break" aria-hidden="true" />
                  Planned break
                </span>
              </div>
            </header>

            <div
              className="tl-plan-v2__axis"
              style={
                {
                  "--tl-plan-label-width": "150px",
                } as CSSProperties
              }
              aria-hidden="true"
            >
              <div />
              <div className="tl-plan-v2__axis-track">
                {ticks.map((minutes, index) => {
                  // The first partial hour (for example 06:45–07:00) is too
                  // narrow to show both clock labels without overlap.
                  if (index === 1 && minutes - ticks[0] < 30) return null;
                  const left =
                    ((minutes - window.startMinutes) /
                      Math.max(
                        1,
                        window.endMinutes - window.startMinutes,
                      )) *
                    100;
                  return (
                    <span
                      key={minutes}
                      style={{ left: `${left}%` }}
                    >
                      {formatClockMinutes(minutes)}
                    </span>
                  );
                })}
                {snapshotInsideShift ? (
                  <span
                    className="tl-plan-v2__snapshot-label"
                    style={{ left: `${snapshotLeft}%` }}
                  >
                    {snapshotLabel}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="tl-plan-v2__rows">
              {shownAssignments.map((assignment) => {
                const shift = lineShift(shifts, assignment);
                const editFailure = assignment.plan_status === "draft"
                  ? "The Manager must publish and approve this plan first."
                  : !shift
                    ? "This plan has no active shift. Ask a Manager to repair it."
                    : !live
                      ? "Operational updates are read-only outside the current shift day."
                      : "";
                const canEditOperations = !editFailure;
                const blocks = planBlocks
                  .filter(
                    (block) => block.assignment === assignment.id,
                  )
                  .sort(
                    (left, right) =>
                      left.sequence_number - right.sequence_number,
                  );
                const displayedBlocks =
                  sequenceView === "products"
                    ? blocks
                    : [...blocks].sort(
                        (left, right) =>
                          new Date(left.planned_start_at).getTime() -
                          new Date(right.planned_start_at).getTime(),
                      );

                return (
                  <article
                    className="tl-plan-v2__row"
                    key={assignment.id}
                  >
                    <div className="tl-plan-v2__line">
                      <strong>
                        {displayLine(assignment.production_line_code)}
                      </strong>
                      <span className="tl-plan-v2__done-count">
                        {shift ? `${NUMBER.format(shift.actual_output)} done` : "Output unavailable"}
                      </span>
                    </div>

                    <div className="tl-plan-v2__track">
                      {ticks.map((minutes) => {
                        const left =
                          ((minutes - window.startMinutes) /
                            Math.max(
                              1,
                              window.endMinutes -
                                window.startMinutes,
                            )) *
                          100;
                        return (
                          <i
                            className="tl-plan-v2__gridline"
                            key={minutes}
                            style={{ left: `${left}%` }}
                            aria-hidden="true"
                          />
                        );
                      })}

                      {displayedBlocks.length ? (
                        displayedBlocks.map((block) => (
                          <button
                            type="button"
                            className={`tl-plan-v2__block tl-plan-v2__block--${block.block_type}`}
                            style={{
                              ...timelineStyle(block.planned_start_at, block.planned_end_at, window),
                              "--tl-plan-done": `${completedFractionForBlock(block, blocks, window, shift)}%`,
                            } as CSSProperties}
                            key={block.id}
                            disabled={block.block_type === "break" || !canEditOperations}
                            title={block.block_type === "break" ? "Planned break" : editFailure || "Record product completion"}
                            onClick={() => openProductCompletion(block)}
                            aria-label={block.block_type === "break" ?
                              `Break ${block.break_number}, ${Math.round((new Date(block.planned_end_at).getTime() - new Date(block.planned_start_at).getTime()) / 60000)} minutes` :
                              `${block.product_name}, ${Math.round(completedFractionForBlock(block, blocks, window, shift))}% of this block's planned output done`}
                          >
                            <strong>
                              {block.block_type === "break"
                                ? `B${block.break_number ?? ""}`
                                : block.product_name}
                            </strong>
                            <span>
                              {block.block_type === "break"
                                ? `${Math.round((new Date(block.planned_end_at).getTime() - new Date(block.planned_start_at).getTime()) / 60000)}m`
                                : `${shortTime(
                                    block.planned_start_at,
                                  )} – ${shortTime(
                                    block.planned_end_at,
                                  )}`}
                            </span>
                          </button>
                        ))
                      ) : (
                        <span className="tl-plan-v2__empty">
                          No plan blocks recorded
                        </span>
                      )}

                      {snapshotInsideShift ? (
                        <i
                          className="tl-plan-v2__snapshot-line"
                          style={{ left: `${snapshotLeft}%` }}
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section
            className="tl-plan-v2__output"
            aria-label="Output by assigned line"
          >
            <h2>Output by assigned line</h2>
            <div className="responsive-table">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Current product</th>
                    <th>Planned output</th>
                    <th>Actual output</th>
                    <th>Short</th>
                    <th>Full-day completion</th>
                    <th>Position now</th>
                  </tr>
                </thead>
                <tbody>
                  {shownAssignments.map((assignment) => {
                    const update = latestUpdate(
                      updates,
                      assignment.id,
                    );
                    const shift = lineShift(shifts, assignment);
                    const blocks = planBlocks.filter((block) => block.assignment === assignment.id);
                    const expectedNow = expectedUnitsNow(blocks, window, shift?.planned_output ?? 0, snapshotMinutes);
                    const delta = expectedNow === null ? null : (shift?.actual_output ?? 0) - expectedNow;
                    const productShort = blocks.reduce((total, block) => total + (block.short_units ?? 0), 0);

                    return (
                      <tr
                        key={assignment.id}
                        className={`tl-plan-v2__output-row${selectedLine === assignment.id ? " is-selected" : ""}`}
                        onClick={() => setSelectedLine(selectedLine === assignment.id ? null : assignment.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className="tl-plan-v2__expand"
                            aria-expanded={selectedLine === assignment.id}
                            aria-controls="tl-plan-v2-detail"
                          >
                            {displayLine(assignment.production_line_code)} {selectedLine === assignment.id ? "▴" : "▾"}
                          </button>
                        </td>
                        <td>
                          {update?.current_product ||
                            planBlocks.find(
                              (block) =>
                                block.assignment === assignment.id &&
                                block.block_type === "production",
                            )?.product_name ||
                            "—"}
                        </td>
                        <td>
                          {NUMBER.format(
                            shift?.planned_output ?? 0,
                          )}
                        </td>
                        <td>
                          {NUMBER.format(shift?.actual_output ?? 0)}
                        </td>
                        <td className={productShort ? "metric-behind" : ""}>{NUMBER.format(productShort)}</td>
                        <td>{completionPercentage(shift)}%</td>
                        <td>
                          <span
                            className={
                              delta !== null && delta >= 0
                                ? "tl-plan-v2__position is-ahead"
                                : "tl-plan-v2__position is-behind"
                            }
                          >
                            {delta !== null ? <i aria-hidden="true" /> : null}
                            {delta === null ? "Target unavailable" : `${NUMBER.format(Math.abs(delta))} ${delta >= 0 ? "ahead" : "behind"}`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {shownAssignments.map((assignment) => {
              if (selectedLine !== assignment.id) return null;
              const shift = lineShift(shifts, assignment);
              const blocks = planBlocks.filter((block) => block.assignment === assignment.id);
              const expectedNow = expectedUnitsNow(blocks, window, shift?.planned_output ?? 0, snapshotMinutes);
              const actual = shift?.actual_output ?? 0;
              const hours = hourlyPlan(
                blocks,
                hourlyOutputs.filter((output) => output.assignment === assignment.id),
                window,
                shift,
                snapshotMinutes,
              );
              const recorded = hours.some((hour) => hour.done !== null);
              const editFailure = assignment.plan_status === "draft"
                ? "The Manager must publish and approve this plan first."
                : !shift
                  ? "This plan has no active shift. Ask a Manager to repair it."
                  : !live
                    ? "Operational updates are read-only outside the current shift day."
                    : "";
              return (
                <div className="tl-plan-v2__detail" id="tl-plan-v2-detail" key={assignment.id}>
                  <div className="tl-plan-v2__detail-heading">
                    <h3>{displayLine(assignment.production_line_code)} · Hourly details</h3>
                    <button type="button" onClick={() => setSelectedLine(null)}>Close details</button>
                  </div>
                  <div className="tl-plan-v2__metrics">
                    <div><span>Actual now</span><strong>{shift ? NUMBER.format(actual) : "—"}</strong></div>
                    <div><span>Target now</span><strong>{expectedNow === null ? "—" : NUMBER.format(expectedNow)}</strong></div>
                    <div><span>Position now</span><strong>{expectedNow === null ? "—" : `${NUMBER.format(Math.abs(actual - expectedNow))} ${actual >= expectedNow ? "ahead" : "behind"}`}</strong></div>
                    <div><span>Shift plan</span><strong>{shift ? NUMBER.format(shift.planned_output) : "—"}</strong></div>
                  </div>
                  <div className="tl-plan-v2__progress-copy"><strong>{expectedNow ? `${Math.round(actual / expectedNow * 100)}% of target due now` : "Target unavailable"}</strong><span>{shift ? `${NUMBER.format(Math.max(0, shift.planned_output - actual))} left in shift` : ""}</span></div>
                  <div className="tl-plan-v2__progress" aria-label="Completed output against full shift plan">
                    <span style={{ width: `${shift?.planned_output ? Math.min(100, actual / shift.planned_output * 100) : 0}%` }} />
                    {expectedNow !== null && shift?.planned_output ? <i style={{ left: `${Math.min(100, expectedNow / shift.planned_output * 100)}%` }} aria-label="Target due now" /> : null}
                  </div>
                  <h4>Product target, done and short</h4>
                  <div className="responsive-table tl-plan-v2__products">
                    <table><thead><tr><th>Product</th><th>Description</th><th>Target</th><th>Done</th><th>Short</th><th>Status / reason</th></tr></thead><tbody>{blocks.filter((block) => block.block_type === "production").map((block) => <tr key={block.id}><td><strong>{block.product_code}</strong></td><td>{block.product_name}</td><td>{NUMBER.format(block.planned_units)}</td><td>{block.actual_units === null || block.actual_units === undefined ? "—" : NUMBER.format(block.actual_units)}</td><td className={(block.short_units ?? 0) > 0 ? "metric-behind" : ""}>{block.short_units === null || block.short_units === undefined ? "—" : NUMBER.format(block.short_units)}</td><td>{block.short_reason ? block.short_reason.replaceAll("_", " ") : block.completion_status === "completed" ? "Target completed" : "Planned"}</td></tr>)}</tbody></table>
                  </div>
                  <h4>Hour-by-hour details <small>Target · done · short · DT by {formatClockMinutes(snapshotMinutes)}</small></h4>
                  <div className="tl-plan-v2__hours">
                    {hours.map((hour) => {
                      const targetDue = hour.future ? hour.target : hour.dueNow;
                      const short = hour.done !== null && targetDue !== null ? Math.max(0, targetDue - hour.done) : null;
                      const green = hour.target && hour.done !== null ? Math.min(100, hour.done / hour.target * 100) : 0;
                      const amber = hour.target && short !== null ? Math.min(100 - green, short / hour.target * 100) : 0;
                      const downtimeMinutes = downtimeMinutesForHour(shift, hour);
                      return <article className={`tl-plan-v2__hour${hour.current ? " is-current" : ""}${downtimeMinutes ? " has-downtime" : ""}`} key={hour.label} aria-label={`${hour.label}, ${downtimeMinutes} downtime minutes.`}>
                        <strong>{hour.label}</strong>
                        <span>{hour.breakMinutes ? `${hour.breakMinutes}m break` : "Production"}</span>
                        <span>T {hour.target === null ? "—" : NUMBER.format(hour.target)}</span>
                        <span>D {hour.done === null ? "—" : NUMBER.format(hour.done)}</span>
                        <span>S {short === null ? "—" : NUMBER.format(short)}</span>
                        <span className="tl-plan-v2__downtime">DT {downtimeMinutes}m</span>
                        <div className="tl-plan-v2__hour-bar" aria-label={`${hour.label}: ${hour.done === null ? "actual output unavailable" : `${hour.done} done`}, ${short === null ? "shortage unavailable" : `${short} short`}, ${downtimeMinutes} downtime minutes`}><i style={{ width: `${green}%` }} /><b style={{ width: `${amber}%` }} /></div>
                        <div className="tl-plan-v2__hour-actions">
                          <button
                            type="button"
                            aria-label={`${hour.done === null ? "Record" : "Edit"} output for ${hour.label}`}
                            disabled={Boolean(editFailure)}
                            title={editFailure || (hour.done === null ? "Record hourly production" : "Edit hourly production")}
                            onClick={() => openOutputHour(assignment, hour)}
                          >
                            {hour.done === null ? "Record output" : "Edit output"}
                          </button>
                          <button
                            type="button"
                            aria-label={`Manage downtime for ${hour.label}, ${downtimeMinutes} minutes recorded`}
                            disabled={Boolean(editFailure)}
                            title={editFailure || "Add, update or delete hourly downtime"}
                            onClick={() => shift && openDowntimeHour(assignment, shift, hour)}
                          >
                            Downtime
                          </button>
                        </div>
                      </article>;
                    })}
                  </div>
                  {!recorded ? <p className="tl-plan-v2__data-note">Hourly actuals have not been recorded for this line. Targets are shown without estimated done or short figures.</p> : null}
                  {editFailure ? <p className="tl-plan-v2__data-note" role="status">Read-only: {editFailure}</p> : null}
                </div>
              );
            })}

            <p className="tl-plan-v2__readonly">
              <AppIcon name="info" size={19} />
              Plan structure is read-only for Team Leaders. Draft plans require Manager publication; published plans can receive production, downtime and product completion evidence.
            </p>
          </section>
          {selectedProductBlock ? (
            <div className="hourly-downtime-backdrop" role="presentation">
              <section className="hourly-downtime-editor" role="dialog" aria-modal="true" aria-labelledby="tl-product-completion-title">
                <header><div><span className="eyebrow">Product completion evidence</span><h2 id="tl-product-completion-title">Finish product / changeover</h2><p>{selectedProductBlock.product_name} · {selectedProductBlock.product_code}</p></div><button type="button" aria-label="Close product completion" onClick={() => setSelectedProductBlock(null)}>×</button></header>
                <form onSubmit={completeProduct}>
                  <div className="hourly-downtime-editor__grid">
                    <label>Planned target<input value={NUMBER.format(selectedProductBlock.planned_units)} readOnly /></label>
                    <label>Completed quantity<input type="number" min="0" value={completedUnits} onChange={(event) => setCompletedUnits(event.target.value)} required /></label>
                    <label>Calculated short<input value={completedUnits === "" ? "—" : NUMBER.format(Math.max(0, selectedProductBlock.planned_units - Number(completedUnits)))} readOnly /></label>
                    {completedUnits !== "" && Number(completedUnits) < selectedProductBlock.planned_units ? <label>Shortfall reason<select value={shortReason ?? ""} onChange={(event) => setShortReason(event.target.value as DailyPlanBlock["short_reason"])} required><option value="">Choose reason</option><option value="material_unavailable">Material unavailable</option><option value="material_delayed">Material delayed</option><option value="quality_hold">Quality hold</option><option value="machine_downtime">Machine downtime</option><option value="labour_shortage">Labour shortage</option><option value="manager_instruction">Manager instruction</option><option value="changeover_brought_forward">Changeover brought forward</option><option value="other">Other</option></select></label> : null}
                    <label className="is-wide">Completion / handover note<textarea rows={3} value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} placeholder="What happened and what product runs next?" /></label>
                  </div>
                  {completionMessage ? <p className="hourly-downtime-editor__message" role="status">{completionMessage}</p> : null}
                  <footer><button type="button" className="button button--ghost" onClick={() => setSelectedProductBlock(null)}>Cancel</button><button type="submit" className="button button--primary" disabled={completionSaving || completedUnits === ""}>{completionSaving ? "Saving…" : "Record completion"}</button></footer>
                </form>
              </section>
            </div>
          ) : null}
          {selectedDowntimeHour ? (
            <div className="hourly-downtime-backdrop" role="presentation">
              <section className="hourly-downtime-editor" role="dialog" aria-modal="true" aria-labelledby="hourly-downtime-title">
                <header>
                  <div><span className="eyebrow">Team Leader · My Plan</span><h2 id="hourly-downtime-title">{displayLine(selectedDowntimeHour.assignment.production_line_code)} · {selectedDowntimeHour.hour.label}</h2><p>Add, update or remove downtime recorded in this hour.</p></div>
                  <button type="button" aria-label="Close hourly downtime" onClick={() => setSelectedDowntimeHour(null)}>×</button>
                </header>
                <div className="hourly-downtime-editor__events">
                  <h3>Recorded downtime</h3>
                  {eventsForHour(selectedDowntimeHour).length ? eventsForHour(selectedDowntimeHour).map((event) => (
                    <article key={event.id}>
                      <div><strong>{event.description}</strong><span>{shortTime(event.started_at)}–{shortTime(event.ended_at ?? event.started_at)} · {event.duration_minutes} min · {event.reason_category}</span></div>
                      <div className="hourly-downtime-editor__actions">
                        <button type="button" onClick={() => editDowntime(event)}>Edit</button>
                        {deleteDowntimeId === event.id ? <><button type="button" className="is-danger" disabled={downtimeSaving} onClick={() => void removeDowntime(event.id)}>Confirm delete</button><button type="button" onClick={() => setDeleteDowntimeId(null)}>Keep</button></> : <button type="button" className="is-danger" onClick={() => setDeleteDowntimeId(event.id)}>Delete</button>}
                      </div>
                    </article>
                  )) : <p className="empty-state">No downtime recorded in this hour.</p>}
                </div>
                <form onSubmit={saveDowntime}>
                  <div className="hourly-downtime-editor__form-heading"><h3>{editingDowntimeId ? "Update downtime" : "Add downtime"}</h3>{editingDowntimeId ? <button type="button" onClick={() => resetDowntimeForm(selectedDowntimeHour)}>Add new instead</button> : null}</div>
                  <div className="hourly-downtime-editor__grid">
                    <label>Start<input type="datetime-local" value={downtimeStartedAt} onChange={(event) => setDowntimeStartedAt(event.target.value)} required /></label>
                    <label>End<input type="datetime-local" value={downtimeEndedAt} onChange={(event) => setDowntimeEndedAt(event.target.value)} required={downtimeStatus === "resolved"} /></label>
                    <label>Reason<select value={downtimeReason} onChange={(event) => setDowntimeReason(event.target.value as DowntimeEvent["reason_category"])}><option value="equipment">Equipment</option><option value="material">Material</option><option value="quality">Quality</option><option value="staffing">Staffing</option><option value="changeover">Changeover</option><option value="other">Other</option></select></label>
                    <label>Owner group<select value={downtimeOwner} onChange={(event) => setDowntimeOwner(event.target.value as DowntimeEvent["owner_group"])}><option value="operations">Operations</option><option value="engineering">Engineering</option><option value="qa">QA</option><option value="machine_minder">Machine Minder</option></select></label>
                    <label>Status<select value={downtimeStatus} onChange={(event) => setDowntimeStatus(event.target.value as DowntimeEvent["status"])}><option value="open">Open</option><option value="resolved">Resolved</option></select></label>
                    <label className="is-wide">Description<input value={downtimeDescription} maxLength={160} onChange={(event) => setDowntimeDescription(event.target.value)} placeholder="What stopped or slowed the line?" required /></label>
                    <label className="is-wide">Resolution / handover note<textarea rows={2} value={downtimeResolution} maxLength={255} onChange={(event) => setDowntimeResolution(event.target.value)} placeholder="What was done, or what must happen next?" /></label>
                  </div>
                  {downtimeMessage ? <p className="hourly-downtime-editor__message" role="status">{downtimeMessage}</p> : null}
                  <footer><button type="button" className="button button--ghost" onClick={() => setSelectedDowntimeHour(null)}>Close</button><button type="submit" className="button button--primary" disabled={downtimeSaving || !downtimeDescription.trim()}>{downtimeSaving ? "Saving…" : editingDowntimeId ? "Save changes" : "Add downtime"}</button></footer>
                </form>
              </section>
            </div>
          ) : null}
          {selectedOutputHour ? (
            <HourlyOutputEditor
              context={selectedOutputHour}
              onClose={() => setSelectedOutputHour(null)}
              onSaved={async (message) => {
                await onSaved?.(message);
              }}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
