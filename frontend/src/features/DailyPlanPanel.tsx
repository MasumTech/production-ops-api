import { useMemo, useState, type CSSProperties } from "react";

import { AppIcon } from "../AppIcon";
import { EmptyState } from "../components";
import {
  dateTimeToShiftMinutes,
  elapsedShiftFraction,
  formatClockMinutes,
  getShiftWindow,
  timelineStyle,
  timelineTicks,
} from "../shiftTiming";
import type {
  Assignment,
  DailyPlanBlock,
  LineUpdate,
  ShiftRecord,
} from "../types";

const NUMBER = new Intl.NumberFormat("en-GB");

type SequenceView = "products" | "schedule";

function shortTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
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

export function DailyPlanPanel({
  assignments,
  planBlocks,
  shifts = [],
  updates = [],
  live = false,
  onRequestPlanChange,
}: {
  assignments: Assignment[];
  planBlocks: DailyPlanBlock[];
  shifts?: ShiftRecord[];
  updates?: LineUpdate[];
  live?: boolean;
  onRequestPlanChange?: (assignmentId: number) => void;
}) {
  const visibleAssignments = assignments.slice(0, 3);
  const operationalDate =
    visibleAssignments[0]?.date ?? new Date().toISOString().slice(0, 10);
  const window = getShiftWindow(operationalDate, shifts, "day");
  const [lineFilter, setLineFilter] = useState("all");
  const [sequenceView, setSequenceView] =
    useState<SequenceView>("products");

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
  const snapshotLabel = `${live ? "Now" : "Snapshot"} ${shortTime(
    snapshotAt.toISOString(),
  )}`;
  const planChangeAssignment =
    shownAssignments[0]?.id ?? visibleAssignments[0]?.id ?? null;

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
                  Production
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
                {ticks.map((minutes) => {
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
                const update = latestUpdate(updates, assignment.id);
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
                      <span>
                        {update?.current_product ||
                          blocks.find(
                            (block) =>
                              block.block_type === "production",
                          )?.product_name ||
                          assignment.production_line_name}
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
                          <div
                            className={`tl-plan-v2__block tl-plan-v2__block--${block.block_type}`}
                            style={timelineStyle(
                              block.planned_start_at,
                              block.planned_end_at,
                              window,
                            )}
                            key={block.id}
                          >
                            <strong>
                              {block.block_type === "break"
                                ? `Break ${block.break_number ?? ""}`
                                : block.product_name}
                            </strong>
                            <span>
                              {block.block_type === "break"
                                ? "40 min"
                                : `${shortTime(
                                    block.planned_start_at,
                                  )} – ${shortTime(
                                    block.planned_end_at,
                                  )}`}
                            </span>
                          </div>
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
                    const expectedNow = Math.round(
                      (shift?.planned_output ?? 0) *
                        elapsedShiftFraction(window, snapshotAt),
                    );
                    const delta =
                      (shift?.actual_output ?? 0) - expectedNow;

                    return (
                      <tr key={assignment.id}>
                        <td>
                          <strong>
                            {displayLine(
                              assignment.production_line_code,
                            )}
                          </strong>
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
                        <td>{completionPercentage(shift)}%</td>
                        <td>
                          <span
                            className={
                              delta >= 0
                                ? "tl-plan-v2__position is-ahead"
                                : "tl-plan-v2__position is-behind"
                            }
                          >
                            <i aria-hidden="true" />
                            {NUMBER.format(Math.abs(delta))}{" "}
                            {delta >= 0 ? "ahead" : "behind"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="tl-plan-v2__readonly">
              <AppIcon name="info" size={19} />
              Published plans are read-only. Request a change for
              Operations Manager review.
            </p>
          </section>
        </>
      )}
    </section>
  );
}
