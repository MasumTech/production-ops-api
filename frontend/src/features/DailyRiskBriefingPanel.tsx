import { useCallback, useEffect, useState } from "react";

import { AppIcon } from "../AppIcon";
import { apiRequest } from "../api";
import { EmptyState, ErrorBanner } from "../components";
import { formatDateTime, titleCase } from "../format";
import type { DailyRiskBriefing, LineRiskBriefing, RiskFactor, RiskLevel } from "../types";

const NUMBER = new Intl.NumberFormat();

function evidenceCopy(factor: RiskFactor): string {
  const entries = Object.entries(factor.evidence);
  if (!entries.length) return "No additional measurements";

  return entries
    .map(([key, value]) => `${titleCase(key)}: ${String(value)}`)
    .join(" · ");
}

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`risk-score-badge risk-score-badge--${level}`}>
      {titleCase(level)} risk
    </span>
  );
}

function primaryAction(line: LineRiskBriefing): string {
  const firstFactor = line.risk_factors[0];

  if (!firstFactor) return "Confirm the latest line position and keep the next update on schedule.";
  if (firstFactor.source === "material") return "Ask the material owner for the confirmed ETA and agree the next production decision point.";
  if (firstFactor.source === "escalation") return "Assign or chase the open action owner, then record the next update time.";
  if (firstFactor.source === "downtime" || firstFactor.source === "asset") return "Confirm engineering response, expected restart, and recovery plan impact.";
  if (firstFactor.source === "shift") return "Review the output gap with the Team Leader and agree the recovery route.";

  return "Review the evidence with the Team Leader before changing the production plan.";
}

export function DailyRiskBriefingPanel({
  operationalDate,
  onOpenLine,
}: {
  operationalDate: string;
  onOpenLine?: (lineId: number) => void;
}) {
  const [briefing, setBriefing] = useState<DailyRiskBriefing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");

    const query = new URLSearchParams({ date: operationalDate });

    try {
      setBriefing(
        await apiRequest<DailyRiskBriefing>(
          `/analytics/daily-risk-briefing/?${query.toString()}`,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load the daily risk briefing.",
      );
    } finally {
      setBusy(false);
    }
  }, [operationalDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const rankedLines = briefing ? [...briefing.lines].sort((left, right) => right.risk_score - left.risk_score || left.production_line_code.localeCompare(right.production_line_code)) : [];
  const priorities = rankedLines.slice(0, 3);
  const selectedLine = rankedLines.find((line) => line.production_line_id === selectedLineId) ?? rankedLines[0] ?? null;
  const totalMaterialRisks = briefing
    ? briefing.lines.reduce((total, line) => total + line.metrics.short_material_items + line.metrics.held_material_items, 0)
    : 0;
  const totalOpenActions = briefing
    ? briefing.lines.reduce((total, line) => total + line.metrics.open_escalations, 0)
    : 0;
  const totalWarnings = briefing
    ? briefing.lines.reduce((total, line) => total + line.missing_data_warnings.length, 0)
    : 0;
  const planCompletion = selectedLine?.metrics.performance_percentage ?? null;

  return (
    <section className="manager-board risk-briefing-board" aria-labelledby="risk-briefing-title">
      <div className="manager-section-heading">
        <div>
          <span className="eyebrow">Explainable evidence</span>
          <h2 id="risk-briefing-title">Briefing cockpit</h2>
        </div>
        <div className="risk-briefing-actions"><small>Generated {briefing ? formatDateTime(briefing.summary.generated_at) : "—"}</small><button className="button button--ghost" onClick={() => void load()} disabled={busy}><AppIcon name="refresh" size={16} />{busy ? "Loading…" : "Refresh"}</button></div>
      </div>

      {error ? (
        <div className="risk-briefing-error">
          <ErrorBanner message={error} />
          <button className="button button--ghost" onClick={() => void load()} disabled={busy}>
            Retry briefing
          </button>
        </div>
      ) : null}

      {busy && !briefing ? (
        <p className="risk-briefing-loading" role="status">
          Loading daily risk briefing…
        </p>
      ) : null}

      {briefing ? (
        <>
          <div className="risk-advisory-banner" role="note">
            <AppIcon name="shield" size={20} />
            <div>
              <strong>Advisory only</strong>
              <span>Deterministic evidence briefing. Managers keep the decision, ownership, and sign-off.</span>
            </div>
          </div>

          <div
            className="risk-briefing-summary"
            role="region"
            aria-label="Risk briefing summary"
          >
            <article>
              <span>Overall position</span>
              <RiskBadge level={briefing.summary.overall_risk_level} />
              <small>Rules v{briefing.summary.rules_version}</small>
            </article>
            <article>
              <span>Highest score</span>
              <strong>{briefing.summary.highest_risk_score} / 100</strong>
              <small>Highest evidence-based line score</small>
            </article>
            <article>
              <span>Data completeness</span>
              <strong>{briefing.summary.average_confidence_percent}%</strong>
              <small>Based on source-data completeness</small>
            </article>
            <article>
              <span>Active signals</span>
              <strong>{briefing.summary.lines_assessed}</strong>
              <small>
                {totalOpenActions} actions · {totalMaterialRisks} material risks
              </small>
            </article>
          </div>

          {rankedLines.length ? (
            <div className="risk-briefing-command">
              <section className="risk-priority-rail" aria-label="Ranked line priorities">
                <header>
                  <span className="eyebrow">Ranked priority</span>
                  <h3>Where to look first</h3>
                </header>
                {priorities.map((line, index) => (
                  <button
                    type="button"
                    className={selectedLine?.production_line_id === line.production_line_id ? "is-selected" : ""}
                    key={line.production_line_id}
                    onClick={() => setSelectedLineId(line.production_line_id)}
                  >
                    <span className="priority-number">{index + 1}</span>
                    <span>
                      <strong>{line.production_line_code}: {line.risk_factors[0]?.reason ?? "Review line evidence"}</strong>
                      <small>{line.risk_score} / 100 · {line.confidence_percent}% confidence</small>
                    </span>
                    <RiskBadge level={line.risk_level} />
                  </button>
                ))}
              </section>

              {selectedLine ? (
                <article className={`risk-decision-panel risk-decision-panel--${selectedLine.risk_level}`} aria-label={`${selectedLine.production_line_code} evidence detail`}>
                  <header>
                    <div>
                      <span className="eyebrow">{selectedLine.production_line_code}</span>
                      <h3>{selectedLine.production_line_name}</h3>
                    </div>
                    <div className="risk-line-card__score">
                      <RiskBadge level={selectedLine.risk_level} />
                      <strong>{selectedLine.risk_score} / 100</strong>
                    </div>
                  </header>

                  <div className="risk-next-action">
                    <span><AppIcon name="lightbulb" size={18} /> Suggested manager action</span>
                    <strong>{primaryAction(selectedLine)}</strong>
                    <button className="button button--primary" onClick={() => onOpenLine?.(selectedLine.production_line_id)}>Open line workspace</button>
                  </div>

                  <dl className="risk-metrics">
                    <div>
                      <dt>Plan completion</dt>
                      <dd>{planCompletion === null ? "No shift output" : `${planCompletion}%`}</dd>
                    </div>
                    <div>
                      <dt>Downtime</dt>
                      <dd>{NUMBER.format(selectedLine.metrics.downtime_minutes)} min</dd>
                    </div>
                    <div>
                      <dt>Open actions</dt>
                      <dd>{selectedLine.metrics.open_escalations}</dd>
                    </div>
                    <div>
                      <dt>Material risks</dt>
                      <dd>{selectedLine.metrics.short_material_items + selectedLine.metrics.held_material_items}</dd>
                    </div>
                  </dl>

                  <section className="risk-evidence" aria-label="Ranked source evidence">
                    <div className="risk-evidence__title">
                      <h4>Ranked evidence</h4>
                      <span>Contributions: {selectedLine.risk_factors.reduce((total, factor) => total + factor.score, 0)} / 100</span>
                    </div>
                    {selectedLine.risk_factors.length ? (
                      <ol>
                        {selectedLine.risk_factors.map((factor) => (
                          <li key={factor.code}>
                            <div className="risk-evidence__heading">
                              <strong>{factor.reason}</strong>
                              <span>+{factor.score}</span>
                            </div>
                            <p>Source: {titleCase(factor.source)} · Severity: {titleCase(factor.severity)}</p>
                            <small>{evidenceCopy(factor)}</small>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="risk-evidence__empty">No scored risk factors.</p>
                    )}
                  </section>
                </article>
              ) : null}

              <aside className="risk-source-panel" aria-label="Source completeness">
                <header>
                  <span className="eyebrow">Source quality</span>
                  <h3>Evidence readiness</h3>
                </header>
                <dl>
                  <div>
                    <dt>Selected confidence</dt>
                    <dd>{selectedLine?.confidence_percent ?? 0}%</dd>
                  </div>
                  <div>
                    <dt>Missing data warnings</dt>
                    <dd>{totalWarnings}</dd>
                  </div>
                  <div>
                    <dt>Critical/high lines</dt>
                    <dd>{briefing.summary.risk_counts.critical + briefing.summary.risk_counts.high}</dd>
                  </div>
                </dl>
                {selectedLine?.missing_data_warnings.length ? (
                  <aside className="risk-data-warnings" aria-label={`${selectedLine.production_line_code} data warnings`}>
                    <strong>Missing evidence lowers data completeness</strong>
                    <ul>
                      {selectedLine.missing_data_warnings.map((warning) => (
                        <li key={warning.code}>
                          {warning.message} <span>Source: {titleCase(warning.source)}</span>
                        </li>
                      ))}
                    </ul>
                  </aside>
                ) : (
                  <p className="risk-data-complete">No missing-data warnings for the selected line.</p>
                )}
              </aside>
            </div>
          ) : (
            <EmptyState
              title="No active lines to assess"
              body="No active production line is available for this operational date."
            />
          )}

          <p className="manager-boundary">
            Deterministic evidence only, generated {formatDateTime(briefing.summary.generated_at)}.
            This briefing does not predict outcomes, control production, or replace approved
            operational decisions.
          </p>
        </>
      ) : null}
    </section>
  );
}
