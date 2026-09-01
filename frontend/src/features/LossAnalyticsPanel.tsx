import { useCallback, useEffect, useState } from "react";

import { apiRequest } from "../api";
import { EmptyState, ErrorBanner } from "../components";
import { titleCase } from "../format";
import type {
  Assignment,
  LossAnalyticsReport,
} from "../types";

const NUMBER = new Intl.NumberFormat();

function localDate(daysBack: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

export function LossAnalyticsPanel({
  assignments,
}: {
  assignments: Assignment[];
}) {
  const [dateFrom, setDateFrom] = useState(() => localDate(29));
  const [dateTo, setDateTo] = useState(() => localDate(0));
  const [productionLine, setProductionLine] = useState("");
  const [report, setReport] = useState<LossAnalyticsReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const lines = Array.from(
    new Map(
      assignments.map((assignment) => [
        assignment.production_line,
        {
          id: assignment.production_line,
          code: assignment.production_line_code,
          name: assignment.production_line_name,
        },
      ]),
    ).values(),
  );

  const load = useCallback(async () => {
    setBusy(true);
    setError("");

    const query = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
    });

    if (productionLine) {
      query.set("production_line", productionLine);
    }

    try {
      setReport(
        await apiRequest<LossAnalyticsReport>(
          `/analytics/loss-assets/?${query.toString()}`,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load loss analytics.",
      );
    } finally {
      setBusy(false);
    }
  }, [dateFrom, dateTo, productionLine]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="manager-board" aria-labelledby="loss-title">
      <div className="manager-section-heading">
        <div>
          <span className="eyebrow">Recorded evidence</span>
          <h2 id="loss-title">Loss and asset history</h2>
        </div>

        <div className="manager-filters">
          <input
            aria-label="Loss start date"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
          <input
            aria-label="Loss end date"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
          <select
            aria-label="Loss production line"
            value={productionLine}
            onChange={(event) => setProductionLine(event.target.value)}
          >
            <option value="">All lines</option>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.code} · {line.name}
              </option>
            ))}
          </select>
          <button onClick={() => void load()} disabled={busy}>
            {busy ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {report ? (
        <>
          <div className="manager-kpis">
            <article className="kpi-card">
              <span>Recorded loss events</span>
              <strong>{NUMBER.format(report.summary.total_events)}</strong>
            </article>
            <article className="kpi-card kpi-card--warning">
              <span>Loss minutes</span>
              <strong>{NUMBER.format(report.summary.total_loss_minutes)}</strong>
            </article>
            <article className="kpi-card">
              <span>Estimated lost units</span>
              <strong>
                {NUMBER.format(
                  report.summary.total_estimated_lost_units,
                )}
              </strong>
            </article>
            <article className="kpi-card kpi-card--danger">
              <span>Recurring assets</span>
              <strong>{report.summary.recurring_asset_count}</strong>
              <small>
                {report.summary.unassigned_asset_events} events need asset mapping
              </small>
            </article>
          </div>

          {report.assets.length ? (
            <div className="table-card manager-table-card">
              <div className="responsive-table">
                <table>
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Occurrences</th>
                      <th>Loss minutes</th>
                      <th>Lost units</th>
                      <th>Open</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.assets.map((row) => (
                      <tr key={row.asset_id}>
                        <td>
                          <strong>
                            {row.production_line_code} · {row.asset_code}
                          </strong>
                          <span>{row.asset_name}</span>
                        </td>
                        <td>{row.occurrences}</td>
                        <td>{NUMBER.format(row.total_loss_minutes)}</td>
                        <td>
                          {NUMBER.format(row.total_estimated_lost_units)}
                        </td>
                        <td>{row.open_events}</td>
                        <td>
                          {row.recurring
                            ? "Repeated-loss evidence"
                            : "Below recurrence threshold"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No mapped asset loss"
              body="No equipment escalation with a mapped asset exists for this period."
            />
          )}

          <p className="manager-boundary">
            Recorded evidence only. Confirm repair, replacement, engineering,
            safety, quality, and financial decisions through approved processes.
          </p>
        </>
      ) : null}
    </section>
  );
}