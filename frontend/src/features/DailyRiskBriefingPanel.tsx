import { useCallback, useEffect, useState } from "react";

import { apiRequest } from "../api";
import { EmptyState, ErrorBanner } from "../components";
import { formatDateTime, titleCase } from "../format";
import type { DailyRiskBriefing, RiskFactor, RiskLevel } from "../types";

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

export function DailyRiskBriefingPanel({
  operationalDate,
}: {
  operationalDate: string;
}) {
  const [briefing, setBriefing] = useState<DailyRiskBriefing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <section className="manager-board" aria-labelledby="risk-briefing-title">
      <div className="manager-section-heading">
        <div>
          <span className="eyebrow">Explainable evidence</span>
          <h2 id="risk-briefing-title">Daily risk briefing</h2>
        </div>
        <button className="button button--ghost" onClick={() => void load()} disabled={busy}>
          {busy ? "Loading…" : "Refresh briefing"}
        </button>
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
              <span>Average confidence</span>
              <strong>{briefing.summary.average_confidence_percent}%</strong>
              <small>Based on source-data completeness</small>
            </article>
            <article>
              <span>Lines assessed</span>
              <strong>{briefing.summary.lines_assessed}</strong>
              <small>
                {briefing.summary.risk_counts.critical} critical ·{" "}
                {briefing.summary.risk_counts.high} high
              </small>
            </article>
          </div>

          {briefing.lines.length ? (
            <div className="risk-line-grid">
              {briefing.lines.map((line) => (
                <article
                  className={`risk-line-card risk-line-card--${line.risk_level}`}
                  key={line.production_line_id}
                >
                  <header className="risk-line-card__header">
                    <div>
                      <span>{line.production_line_code}</span>
                      <h3>{line.production_line_name}</h3>
                    </div>
                    <div className="risk-line-card__score">
                      <RiskBadge level={line.risk_level} />
                      <strong>{line.risk_score} / 100</strong>
                      <small>{line.confidence_percent}% confidence</small>
                    </div>
                  </header>

                  <dl className="risk-metrics">
                    <div>
                      <dt>Output</dt>
                      <dd>
                        {NUMBER.format(line.metrics.actual_output)} /{" "}
                        {NUMBER.format(line.metrics.planned_output)}
                      </dd>
                    </div>
                    <div>
                      <dt>Downtime</dt>
                      <dd>{NUMBER.format(line.metrics.downtime_minutes)} min</dd>
                    </div>
                    <div>
                      <dt>Open actions</dt>
                      <dd>{line.metrics.open_escalations}</dd>
                    </div>
                    <div>
                      <dt>Material risks</dt>
                      <dd>
                        {line.metrics.short_material_items + line.metrics.held_material_items}
                      </dd>
                    </div>
                  </dl>

                  <div className="risk-evidence">
                    <h4>Ranked evidence</h4>
                    {line.risk_factors.length ? (
                      <ol>
                        {line.risk_factors.map((factor) => (
                          <li key={factor.code}>
                            <div className="risk-evidence__heading">
                              <strong>{factor.reason}</strong>
                              <span>+{factor.score}</span>
                            </div>
                            <p>
                              Source: {titleCase(factor.source)} · Severity:{" "}
                              {titleCase(factor.severity)}
                            </p>
                            <small>{evidenceCopy(factor)}</small>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="risk-evidence__empty">No scored risk factors.</p>
                    )}
                  </div>

                  {line.missing_data_warnings.length ? (
                    <aside className="risk-data-warnings" aria-label={`${line.production_line_code} data warnings`}>
                      <strong>Missing evidence lowers confidence</strong>
                      <ul>
                        {line.missing_data_warnings.map((warning) => (
                          <li key={warning.code}>
                            {warning.message} <span>Source: {titleCase(warning.source)}</span>
                          </li>
                        ))}
                      </ul>
                    </aside>
                  ) : (
                    <p className="risk-data-complete">No missing-data warnings.</p>
                  )}
                </article>
              ))}
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
