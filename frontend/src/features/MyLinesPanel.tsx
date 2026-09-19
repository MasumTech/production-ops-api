import { useMemo, useState, type CSSProperties } from "react";

import { AppIcon } from "../AppIcon";
import { EmptyState } from "../components";
import { titleCase } from "../format";
import {
  dateTimeToShiftMinutes,
  formatClockMinutes,
  getShiftWindow,
  timeBuckets,
  timelineStyle,
  timelineTicks,
} from "../shiftTiming";
import type {
  Assignment,
  DailyPlanBlock,
  DowntimeEvent,
  RagStatus,
  ShiftRecord,
  WorkspaceData,
  WorkspaceTab,
} from "../types";

type LineView = {
  assignment: Assignment;
  blocks: DailyPlanBlock[];
  shift?: ShiftRecord;
  events: DowntimeEvent[];
  product: string;
  status: RagStatus;
  planned: number;
  hourlyTarget: number;
  actual: number;
  progress: number;
  variance: number;
  downtime: number;
};

function minutesOfDay(value: string): number {
  const parsed = new Date(value);
  return parsed.getHours() * 60 + parsed.getMinutes();
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}

function lineLabel(code: string, index: number): string {
  const lineNumber = code.match(/(\d+)$/)?.[1];
  return `Line ${lineNumber ? Number(lineNumber) : index + 1}`;
}

function plannedProgressAt(
  blocks: DailyPlanBlock[],
  recordedAt: string | undefined,
): number {
  if (!recordedAt || blocks.length === 0) return 1;
  const recordedMinute = minutesOfDay(recordedAt);
  const productionBlocks = blocks.filter((block) => block.block_type === "production");
  const totalMinutes = productionBlocks.reduce(
    (total, block) =>
      total + Math.max(0, minutesOfDay(block.planned_end_at) - minutesOfDay(block.planned_start_at)),
    0,
  );
  if (!totalMinutes) return 1;
  const elapsedMinutes = productionBlocks.reduce((total, block) => {
    const start = minutesOfDay(block.planned_start_at);
    const end = minutesOfDay(block.planned_end_at);
    return total + Math.max(0, Math.min(end, recordedMinute) - start);
  }, 0);
  return Math.min(1, Math.max(0.01, elapsedMinutes / totalMinutes));
}

function statusLabel(status: RagStatus): string {
  if (status === "green") return "On track";
  if (status === "amber") return "Behind plan";
  return "Action required";
}

function eventMinutesInBucket(
  event: DowntimeEvent,
  startMinutes: number,
  endMinutes: number,
  shiftStartMinutes: number,
  shiftEndMinutes: number,
): number {
  const window = {
    startMinutes: shiftStartMinutes,
    endMinutes: shiftEndMinutes,
    startLabel: formatClockMinutes(shiftStartMinutes),
    endLabel: formatClockMinutes(shiftEndMinutes),
  };
  const eventStart = dateTimeToShiftMinutes(event.started_at, window);
  const eventEnd = event.ended_at
    ? dateTimeToShiftMinutes(event.ended_at, window)
    : eventStart + event.duration_minutes;
  return Math.max(
    0,
    Math.min(eventEnd, endMinutes) - Math.max(eventStart, startMinutes),
  );
}

function buildLineViews(data: WorkspaceData): LineView[] {
  return data.assignments.slice(0, 3).map((assignment) => {
    const update = data.updates
      .filter((item) => item.assignment === assignment.id)
      .sort(
        (left, right) =>
          new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime(),
      )[0];
    const blocks = data.planBlocks
      .filter((block) => block.assignment === assignment.id)
      .sort((left, right) => left.sequence_number - right.sequence_number);
    const shift = data.shifts.find(
      (item) =>
        item.production_line === assignment.production_line &&
        item.date === assignment.date &&
        item.shift_type === assignment.shift_type,
    );
    const events = data.downtimeEvents.filter(
      (event) => event.production_line === assignment.production_line,
    );
    const firstProductionBlock = blocks.find((block) => block.block_type === "production");
    const planned =
      shift?.planned_output ??
      blocks.reduce((total, block) => total + block.planned_units, 0);
    const actual = shift?.actual_output ?? 0;
    const progress = planned ? Math.round((actual / planned) * 100) : 0;
    const expectedOutput = planned * plannedProgressAt(blocks, update?.recorded_at);
    const variance = expectedOutput
      ? Math.round(((actual - expectedOutput) / expectedOutput) * 100)
      : progress - 100;

    return {
      assignment,
      blocks,
      shift,
      events,
      product: update?.current_product || firstProductionBlock?.product_name || "Plan not published",
      status: update?.status ?? "amber",
      planned,
      hourlyTarget: planned
        ? Math.round(planned / 10)
        : firstProductionBlock?.target_units_per_hour ?? 0,
      actual,
      progress,
      variance,
      downtime: events.reduce((total, event) => total + event.duration_minutes, 0),
    };
  });
}

export function MyLinesPanel({
  data,
  onRaiseIssue,
  onNavigate,
}: {
  data: WorkspaceData;
  onRaiseIssue: (assignmentId: number, mode: "update" | "escalation") => void;
  onNavigate: (tab: WorkspaceTab) => void;
}) {
  const lines = useMemo(() => buildLineViews(data), [data]);
  const operationalDate = data.assignments[0]?.date ?? new Date().toISOString().slice(0, 10);
  const shiftWindow = useMemo(
    () => getShiftWindow(operationalDate, data.shifts, "day"),
    [data.shifts, operationalDate],
  );
  const timelineLabels = useMemo(() => timelineTicks(shiftWindow), [shiftWindow]);
  const downtimeBuckets = useMemo(() => timeBuckets(shiftWindow), [shiftWindow]);
  const [hourlyOpen, setHourlyOpen] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const selectedLine =
    lines.find((line) => line.assignment.production_line === selectedLineId) ?? lines[0];
  const worstLine = [...lines].sort((left, right) => {
    const statusWeight = { green: 0, amber: 1, red: 2 };
    return (
      statusWeight[right.status] - statusWeight[left.status] ||
      right.downtime - left.downtime
    );
  })[0];

  const showHourlyDowntime = (line: LineView) => {
    setSelectedLineId(line.assignment.production_line);
    setHourlyOpen(true);
  };

  return (
    <section className="team-lines">
      <header className="team-lines__intro">
        <h1>My lines</h1>
        <p>Live status and plan for today&apos;s production</p>
      </header>

      {data.assignments.length > 3 ? (
        <div className="scope-warning" role="alert">
          This Team Leader has {data.assignments.length} assignments. The control board supports up
          to three active lines; ask Operations to review today&apos;s allocation.
        </div>
      ) : null}

      {lines.length === 0 ? (
        <EmptyState
          title="No lines assigned for today"
          body="Ask an authorised manager to create the date- and shift-specific assignment."
        />
      ) : (
        <>
          <div className="team-line-cards">
            {lines.map((line, index) => (
              <article className="team-line-card" key={line.assignment.id}>
                <header className="team-line-card__header">
                  <div>
                    <h2>{lineLabel(line.assignment.production_line_code, index)}</h2>
                    <strong>{line.product}</strong>
                  </div>
                  <div className="team-line-card__status">
                    <span className={`line-status line-status--${line.status}`}>
                      <span aria-hidden="true" />
                      {statusLabel(line.status)}
                    </span>
                    <button
                      type="button"
                      className="line-downtime-total"
                      aria-expanded={
                        hourlyOpen &&
                        selectedLine?.assignment.production_line ===
                          line.assignment.production_line
                      }
                      onClick={() => showHourlyDowntime(line)}
                    >
                      <AppIcon name="clock" size={14} />
                      {line.downtime} min downtime
                    </button>
                  </div>
                </header>
                <dl className="team-line-metrics">
                  <div>
                    <dt>Planned quantity</dt>
                    <dd>{formatNumber(line.planned)} <small>packs</small></dd>
                  </div>
                  <div>
                    <dt>Hourly target</dt>
                    <dd>{formatNumber(line.hourlyTarget)} <small>packs</small></dd>
                  </div>
                  <div>
                    <dt>Actual so far</dt>
                    <dd>{formatNumber(line.actual)} <small>packs</small></dd>
                  </div>
                  <div>
                    <dt>vs plan</dt>
                    <dd className={line.variance >= 0 ? "metric-positive" : "metric-negative"}>
                      {line.variance >= 0 ? "+" : ""}{line.variance}%
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          <section className="team-product-timeline" aria-labelledby="product-timeline-heading">
            <header>
              <h2 id="product-timeline-heading">
                Today&apos;s product timeline <span>{shiftWindow.startLabel} – {shiftWindow.endLabel}</span>
              </h2>
              <button
                type="button"
                className="timeline-detail-toggle"
                aria-expanded={hourlyOpen}
                onClick={() => setHourlyOpen((current) => !current)}
              >
                <AppIcon name="clock" size={16} />
                Hourly downtime
              </button>
            </header>
            <div className="team-timeline-scroll">
              <div className="team-timeline-hours" aria-hidden="true">
                <span />
                {timelineLabels.map((minutes) => (
                  <time key={minutes}>{formatClockMinutes(minutes)}</time>
                ))}
              </div>
              {lines.map((line, index) => (
                <div className="team-timeline-row" key={line.assignment.id}>
                  <div className="team-timeline-label">
                    <strong>{lineLabel(line.assignment.production_line_code, index)}</strong>
                    <span>{line.product}</span>
                  </div>
                  <div className="team-timeline-track">
                    {line.blocks.map((block) => (
                      <div
                        className={
                          block.block_type === "break"
                            ? "team-timeline-block team-timeline-block--break"
                            : `team-timeline-block team-timeline-block--production team-timeline-block--line-${index + 1}`
                        }
                        key={block.id}
                        style={timelineStyle(block.planned_start_at, block.planned_end_at, shiftWindow)}
                        title={`${block.block_type === "break" ? `Break ${block.break_number}` : block.product_name}: ${formatTime(block.planned_start_at)}–${formatTime(block.planned_end_at)}`}
                      >
                        <strong>
                          {block.block_type === "break" ? "Break" : block.product_name}
                        </strong>
                        <span>{formatTime(block.planned_start_at)} – {formatTime(block.planned_end_at)}</span>
                      </div>
                    ))}
                    {line.events.map((event) => (
                      <button
                        type="button"
                        className={`team-downtime-event team-downtime-event--${event.status === "open" ? "red" : "amber"}`}
                        key={event.id}
                        style={timelineStyle(
                          event.started_at,
                          event.ended_at ?? new Date(
                            new Date(event.started_at).getTime() +
                              event.duration_minutes * 60_000,
                          ).toISOString(),
                          shiftWindow,
                        )}
                        aria-label={`${lineLabel(line.assignment.production_line_code, index)} downtime: ${event.description}, ${event.duration_minutes} minutes`}
                        onClick={() => showHourlyDowntime(line)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {hourlyOpen && selectedLine ? (
              <div className="team-hourly-downtime">
                <header>
                  <div>
                    <h3>Hourly downtime · {lineLabel(
                      selectedLine.assignment.production_line_code,
                      lines.indexOf(selectedLine),
                    )}</h3>
                    <p>Planned breaks are excluded from recorded loss.</p>
                  </div>
                  <div className="team-hourly-tabs">
                    {lines.map((line, index) => (
                      <button
                        type="button"
                        className={
                          selectedLine.assignment.production_line ===
                          line.assignment.production_line
                            ? "is-active"
                            : ""
                        }
                        key={line.assignment.id}
                        onClick={() => setSelectedLineId(line.assignment.production_line)}
                      >
                        {lineLabel(line.assignment.production_line_code, index)}
                      </button>
                    ))}
                  </div>
                </header>
                <div className="team-hourly-grid">
                  {downtimeBuckets.map((bucket) => {
                    const hourEvents = selectedLine.events.filter(
                      (event) =>
                        eventMinutesInBucket(
                          event,
                          bucket.startMinutes,
                          bucket.endMinutes,
                          shiftWindow.startMinutes,
                          shiftWindow.endMinutes,
                        ) > 0,
                    );
                    const minutes = hourEvents.reduce(
                      (total, event) =>
                        total +
                        eventMinutesInBucket(
                          event,
                          bucket.startMinutes,
                          bucket.endMinutes,
                          shiftWindow.startMinutes,
                          shiftWindow.endMinutes,
                        ),
                      0,
                    );
                    return (
                      <article className={minutes ? "has-loss" : ""} key={bucket.startMinutes}>
                        <span>{bucket.label}</span>
                        <strong>{minutes} min</strong>
                        <small>
                          {hourEvents.length
                            ? hourEvents.map((event) => event.description).join(" · ")
                            : "No recorded loss"}
                        </small>
                        {hourEvents.length ? (
                          <small>
                            {hourEvents
                              .map(
                                (event) =>
                                  `${formatTime(event.started_at)}–${formatTime(
                                    event.ended_at ?? new Date(
                                      new Date(event.started_at).getTime() +
                                        event.duration_minutes * 60_000,
                                    ).toISOString(),
                                  )}`,
                              )
                              .join(" · ")}
                          </small>
                        ) : null}
                        {hourEvents.length ? (
                          <small>
                            {hourEvents
                              .map(
                                (event) =>
                                  `${titleCase(event.owner_group)} · ${titleCase(event.status)}`,
                              )
                              .join(" · ")}
                          </small>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>

          <section className="team-progress-card" aria-labelledby="progress-heading">
            <h2 id="progress-heading">Progress vs plan</h2>
            <div className="team-progress-grid">
              {lines.map((line, index) => (
                <article key={line.assignment.id}>
                  <div>
                    <strong>{lineLabel(line.assignment.production_line_code, index)}</strong>
                    <span>{line.product}</span>
                    <span>{formatNumber(line.actual)} / {formatNumber(line.planned)}</span>
                    <strong>{line.progress}%</strong>
                  </div>
                  <div className="team-progress-track">
                    <span
                      className={`team-progress-fill team-progress-fill--${line.status}`}
                      style={{ width: `${Math.min(100, line.progress)}%` }}
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="team-priority-card" aria-labelledby="priority-heading">
            <div className="team-priority-copy">
              <h2 id="priority-heading">Priority suggestion</h2>
              <div>
                <span className="team-priority-icon" aria-hidden="true">!</span>
                <p>
                  {worstLine?.status === "green"
                    ? "Both lines are controlled. Continue the approved hourly checks and monitor the next update."
                    : `${lineLabel(
                        worstLine?.assignment.production_line_code ?? "",
                        Math.max(0, lines.indexOf(worstLine)),
                      )} is ${worstLine?.status === "red" ? "requiring action" : "behind plan"}. Check material availability, confirm equipment condition and request the appropriate functional support.`}
                </p>
              </div>
            </div>
            <div className="team-support-options">
              <span>Suggested support</span>
              <div>
                {["Operative", "Machine Minder", "QA", "Engineering"].map((role) => (
                  <span key={role}>{role}</span>
                ))}
              </div>
            </div>
          </section>

          <section className="team-quick-actions" aria-labelledby="quick-actions-heading">
            <h2 id="quick-actions-heading">Quick actions</h2>
            <div>
              <button type="button" onClick={() => onRaiseIssue(lines[0].assignment.id, "update")}>
                <AppIcon name="edit" size={24} /> Update line
              </button>
              <button
                type="button"
                onClick={() =>
                  onRaiseIssue(
                    worstLine?.assignment.id ?? lines[0].assignment.id,
                    "escalation",
                  )
                }
              >
                <AppIcon name="warning" size={25} /> Raise issue
              </button>
              <button type="button" onClick={() => onNavigate("materials")}>
                <AppIcon name="package" size={25} /> Material problem
              </button>
              <button type="button" onClick={() => onNavigate("handover")}>
                <AppIcon name="clipboard" size={24} /> Handover
              </button>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
