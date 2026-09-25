import { useMemo, useState, type CSSProperties } from "react";

import { AppIcon } from "../AppIcon";
import { EmptyState } from "../components";
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
  HourlyOutput,
  LineUpdate,
  ShiftRecord,
} from "../types";
import { completedFractionForBlock, expectedUnitsNow, hourlyPlan } from "./dailyPlanMath";

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

export function DailyPlanPanel({
  assignments,
  planBlocks,
  hourlyOutputs = [],
  shifts = [],
  updates = [],
  live = false,
  onRequestPlanChange,
}: {
  assignments: Assignment[];
  planBlocks: DailyPlanBlock[];
  hourlyOutputs?: HourlyOutput[];
  shifts?: ShiftRecord[];
  updates?: LineUpdate[];
  live?: boolean;
  onRequestPlanChange?: (assignmentId: number) => void;
}) {
  const visibleAssignments = assignments;
  const operationalDate =
    visibleAssignments[0]?.date ?? new Date().toISOString().slice(0, 10);
  const window = getShiftWindow(operationalDate, shifts, "day");
  const [lineFilter, setLineFilter] = useState("all");
  const [sequenceView, setSequenceView] =
    useState<SequenceView>("products");
  const [selectedLine, setSelectedLine] = useState<number | null>(null);

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
                          <div
                            className={`tl-plan-v2__block tl-plan-v2__block--${block.block_type}`}
                            style={{
                              ...timelineStyle(block.planned_start_at, block.planned_end_at, window),
                              "--tl-plan-done": `${completedFractionForBlock(block, blocks, window, shift)}%`,
                            } as CSSProperties}
                            key={block.id}
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
                    const blocks = planBlocks.filter((block) => block.assignment === assignment.id);
                    const expectedNow = expectedUnitsNow(blocks, window, shift?.planned_output ?? 0, snapshotMinutes);
                    const delta = expectedNow === null ? null : (shift?.actual_output ?? 0) - expectedNow;

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
                  <h4>Hour-by-hour details <small>Target · done · short by {formatClockMinutes(snapshotMinutes)}</small></h4>
                  <div className="tl-plan-v2__hours">
                    {hours.map((hour) => {
                      const short = hour.done !== null && hour.dueNow !== null ? Math.max(0, hour.dueNow - hour.done) : null;
                      const green = hour.target && hour.done !== null ? Math.min(100, hour.done / hour.target * 100) : 0;
                      const amber = hour.target && short !== null ? Math.min(100 - green, short / hour.target * 100) : 0;
                      return <div className={`tl-plan-v2__hour${hour.current ? " is-current" : ""}`} key={hour.label}>
                        <strong>{hour.label}</strong>
                        <span>{hour.breakMinutes ? `${hour.breakMinutes}m break` : "Production"}</span>
                        <span>T {hour.target === null ? "—" : NUMBER.format(hour.target)}</span>
                        <span>D {hour.done === null ? "—" : NUMBER.format(hour.done)}</span>
                        <span>S {short === null ? "—" : NUMBER.format(short)}</span>
                        <div className="tl-plan-v2__hour-bar" aria-label={`${hour.label}: ${hour.done === null ? "actual output unavailable" : `${hour.done} done`}, ${short === null ? "shortage unavailable" : `${short} short`}`}><i style={{ width: `${green}%` }} /><b style={{ width: `${amber}%` }} /></div>
                      </div>;
                    })}
                  </div>
                  {!recorded ? <p className="tl-plan-v2__data-note">Hourly actuals have not been recorded for this line. Targets are shown without estimated done or short figures.</p> : null}
                </div>
              );
            })}

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
