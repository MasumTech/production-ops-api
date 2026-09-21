import { useEffect, useMemo, useState } from "react";

import { apiRequest, OfflineQueuedError, postJson } from "../api";
import { AppIcon } from "../AppIcon";
import {
  AssignmentSelect,
  EmptyState,
  ErrorBanner,
  SubmitButton,
  UserSelect,
} from "../components";
import { formatScheduleClock } from "../shiftTiming";
import type {
  Assignment,
  MaterialReadiness,
  MaterialStatus,
  UserChoice,
} from "../types";

function lineLabel(code: string): string {
  const match = code.match(/(\d+)$/);
  return match ? `Line ${Number(match[1])}` : code;
}

function clock(value: string | null | undefined): string {
  if (!value) return "Not set";
  return formatScheduleClock(value);
}

function wallClockIso(value: string): string | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
  return normalized ? new Date(value).toISOString() : null;
}

function statusLabel(status: MaterialStatus): string {
  return {
    ready: "READY",
    in_process: "IN PROCESS",
    short: "SHORT",
    held: "HELD",
  }[status];
}

function shortageCopy(item: MaterialReadiness): string {
  if (item.risk_summary?.trim()) return item.risk_summary.trim();
  if (item.status === "short" && item.shortage_quantity) {
    return `${item.shortage_quantity} short`;
  }
  if (item.status === "held" && item.hold_reason) return item.hold_reason;
  return "—";
}

function responsibleCopy(item: MaterialReadiness): string {
  return (
    item.responsible_role?.trim() ||
    item.owner_username ||
    (item.status === "ready" ? "Operations" : "Unassigned")
  );
}

function expectedActionCopy(item: MaterialReadiness): string {
  if (item.expected_available_at) {
    const action = item.expected_action?.trim();
    return `ETA ${clock(item.expected_available_at)}${action && !/^eta\b/i.test(action) ? ` · ${action}` : ""}`;
  }
  if (item.expected_action?.trim()) return item.expected_action.trim();
  if (item.status === "ready") return "Available";
  if (item.status === "held") return "Do not use";
  if (item.expected_available_at) {
    return `ETA ${clock(item.expected_available_at)}`;
  }
  return "Not set";
}

function detailShortage(item: MaterialReadiness): string {
  const base = shortageCopy(item);
  if (item.status === "short" && base !== "—" && !/short/i.test(base)) {
    return `${base} short`;
  }
  return base;
}

export function MaterialsPanel({
  assignments,
  materials,
  users,
  onSaved,
  onRaiseIssue,
}: {
  assignments: Assignment[];
  materials: MaterialReadiness[];
  users: UserChoice[];
  onSaved: (message: string) => Promise<void>;
  onRaiseIssue: (item: MaterialReadiness) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [lineFilter, setLineFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [assignment, setAssignment] = useState("");
  const [sequence, setSequence] = useState("1");
  const [productCode, setProductCode] = useState("");
  const [productName, setProductName] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState("0");
  const [status, setStatus] = useState<MaterialStatus>("ready");
  const [shortageQuantity, setShortageQuantity] = useState("0");
  const [owner, setOwner] = useState("");
  const [expectedAvailable, setExpectedAvailable] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [riskSummary, setRiskSummary] = useState("");
  const [responsibleRole, setResponsibleRole] = useState("Operations");
  const [expectedAction, setExpectedAction] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (
      selectedId !== null &&
      materials.some((item) => item.id === selectedId)
    ) {
      return;
    }
    const preferred =
      materials.find((item) => item.status === "short") ??
      materials.find((item) => item.status === "held") ??
      materials[0];
    setSelectedId(preferred?.id ?? null);
  }, [materials, selectedId]);

  const filteredMaterials = useMemo(() => {
    const query = search.trim().toLowerCase();
    return materials.filter((item) => {
      const matchesLine =
        lineFilter === "all" || String(item.assignment) === lineFilter;
      const matchesStatus =
        statusFilter === "all" || item.status === statusFilter;
      const matchesSearch =
        !query ||
        [
          item.product_code,
          item.product_name,
          item.risk_summary ?? "",
          item.responsible_role ?? "",
          item.notes,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      return matchesLine && matchesStatus && matchesSearch;
    });
  }, [lineFilter, materials, search, statusFilter]);

  const selected =
    materials.find((candidate) => candidate.id === selectedId) ?? null;

  const resetForm = () => {
    setEditingId(null);
    setAssignment("");
    setSequence("1");
    setProductCode("");
    setProductName("");
    setPlannedQuantity("0");
    setStatus("ready");
    setShortageQuantity("0");
    setOwner("");
    setExpectedAvailable("");
    setNeededBy("");
    setRiskSummary("");
    setResponsibleRole("Operations");
    setExpectedAction("");
    setNextAction("");
    setHoldReason("");
    setNotes("");
  };

  const openAddForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (item: MaterialReadiness) => {
    setEditingId(item.id);
    setAssignment(String(item.assignment));
    setSequence(String(item.sequence_number));
    setProductCode(item.product_code);
    setProductName(item.product_name);
    setPlannedQuantity(String(item.planned_quantity));
    setStatus(item.status);
    setShortageQuantity(String(item.shortage_quantity || 0));
    setOwner(item.owner ? String(item.owner) : "");
    setExpectedAvailable(
      item.expected_available_at
        ? new Date(item.expected_available_at).toISOString().slice(0, 16)
        : "",
    );
    setNeededBy(
      item.needed_by_at
        ? new Date(item.needed_by_at).toISOString().slice(0, 16)
        : "",
    );
    setRiskSummary(item.risk_summary ?? "");
    setResponsibleRole(item.responsible_role ?? "");
    setExpectedAction(item.expected_action ?? "");
    setNextAction(item.next_action ?? "");
    setHoldReason(item.hold_reason);
    setNotes(item.notes);
    setShowForm(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const payload = {
      assignment: Number(assignment),
      sequence_number: Number(sequence),
      product_code: productCode.trim(),
      product_name: productName.trim(),
      planned_quantity: Number(plannedQuantity),
      status,
      shortage_quantity:
        status === "short" ? Number(shortageQuantity) : 0,
      owner: owner ? Number(owner) : null,
      expected_available_at:
        status === "short" || status === "in_process"
          ? wallClockIso(expectedAvailable)
          : null,
      needed_by_at: neededBy ? wallClockIso(neededBy) : null,
      risk_summary: riskSummary.trim(),
      responsible_role: responsibleRole.trim(),
      expected_action: expectedAction.trim(),
      next_action: nextAction.trim(),
      hold_reason: status === "held" ? holdReason.trim() : "",
      notes: notes.trim(),
    };

    try {
      if (editingId) {
        await apiRequest<MaterialReadiness>(
          `/product-material-readiness/${editingId}/`,
          {
            method: "PATCH",
            body: JSON.stringify(payload),
          },
        );
        await onSaved("Material readiness item updated.");
      } else {
        await postJson<MaterialReadiness>(
          "/product-material-readiness/",
          payload,
        );
        await onSaved("Material readiness item added.");
      }
      resetForm();
      setShowForm(false);
    } catch (caught) {
      if (!editingId && caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
        resetForm();
        setShowForm(false);
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : `Could not ${editingId ? "update" : "add"} the material item.`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="materials-v2">
      <header className="materials-v2__hero">
        <div>
          <h1>Materials</h1>
          <p>
            Readiness, shortages, holds and safe expected times for assigned
            lines
          </p>
        </div>
        <button
          type="button"
          className="materials-v2__add"
          onClick={() => {
            if (showForm) {
              resetForm();
              setShowForm(false);
            } else {
              openAddForm();
            }
          }}
        >
          {showForm ? "Close form" : "Add item"}
        </button>
      </header>

      {error ? <ErrorBanner message={error} /> : null}

      {showForm ? (
        <form
          className="form-card form-grid materials-v2__form"
          onSubmit={save}
        >
          <label className="span-2">
            Assigned line
            <AssignmentSelect
              assignments={assignments}
              value={assignment}
              onChange={(event) => setAssignment(event.target.value)}
              required
            />
          </label>
          <label>
            Sequence
            <input
              aria-label="Sequence"
              type="number"
              min="1"
              value={sequence}
              onChange={(event) => setSequence(event.target.value)}
              required
            />
          </label>
          <label>
            Status
            <select
              aria-label="Status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as MaterialStatus)
              }
              disabled={
                editingId !== null &&
                materials.find((item) => item.id === editingId)?.status ===
                  "held"
              }
            >
              <option value="ready">Ready</option>
              <option value="in_process">In Process</option>
              <option value="short">Short</option>
              <option value="held">Held</option>
            </select>
          </label>
          <label>
            Product code
            <input
              aria-label="Product code"
              value={productCode}
              onChange={(event) => setProductCode(event.target.value)}
              required
            />
          </label>
          <label>
            Product name
            <input
              aria-label="Product name"
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              required
            />
          </label>
          <label>
            Planned quantity
            <input
              aria-label="Planned quantity"
              type="number"
              min="0"
              value={plannedQuantity}
              onChange={(event) => setPlannedQuantity(event.target.value)}
              required
            />
          </label>
          <label>
            Needed by
            <input
              aria-label="Needed by"
              type="datetime-local"
              value={neededBy}
              onChange={(event) => setNeededBy(event.target.value)}
              required
            />
          </label>
          <label>
            Risk / shortage
            <input
              aria-label="Risk or shortage"
              value={riskSummary}
              onChange={(event) => setRiskSummary(event.target.value)}
              placeholder="e.g. 120 kg or QA label release"
            />
          </label>
          <label>
            Responsible role
            <input
              aria-label="Responsible role"
              value={responsibleRole}
              onChange={(event) => setResponsibleRole(event.target.value)}
              placeholder="Operations, Materials, QA…"
              required
            />
          </label>
          <label>
            Expected / action
            <input
              aria-label="Expected or action"
              value={expectedAction}
              onChange={(event) => setExpectedAction(event.target.value)}
              placeholder="Available, ETA 11:30, Do not use…"
            />
          </label>
          <label>
            Next action
            <input
              aria-label="Next action"
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="Confirm replenishment"
            />
          </label>
          <label>
            Action owner {status === "short" ? "(required)" : ""}
            <UserSelect
              users={users}
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              required={status === "short"}
            />
          </label>

          {status === "short" ? (
            <>
              <label>
                Shortage quantity
                <input
                  aria-label="Shortage quantity"
                  type="number"
                  min="1"
                  value={shortageQuantity}
                  onChange={(event) =>
                    setShortageQuantity(event.target.value)
                  }
                  required
                />
              </label>
              <label>
                Expected available
                <input
                  aria-label="Expected available"
                  type="datetime-local"
                  value={expectedAvailable}
                  onChange={(event) =>
                    setExpectedAvailable(event.target.value)
                  }
                  required
                />
              </label>
            </>
          ) : null}

          {status === "in_process" ? (
            <label>
              Expected available
              <input
                aria-label="Expected available"
                type="datetime-local"
                value={expectedAvailable}
                onChange={(event) =>
                  setExpectedAvailable(event.target.value)
                }
              />
            </label>
          ) : null}

          {status === "held" ? (
            <label className="span-2">
              Hold reason
              <textarea
                aria-label="Hold reason"
                value={holdReason}
                onChange={(event) => setHoldReason(event.target.value)}
                rows={3}
                required
              />
            </label>
          ) : null}

          <label className="span-2">
            Description
            <textarea
              aria-label="Description"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
            />
          </label>

          <div className="form-actions span-2">
            <SubmitButton busy={busy}>
              {editingId ? "Update readiness item" : "Add readiness item"}
            </SubmitButton>
          </div>
        </form>
      ) : null}

      <div className="materials-v2__filters">
        <select
          aria-label="Filter by assigned line"
          value={lineFilter}
          onChange={(event) => setLineFilter(event.target.value)}
        >
          <option value="all">All assigned lines</option>
          {assignments.slice(0, 3).map((item) => (
            <option value={item.id} key={item.id}>
              {lineLabel(item.production_line_code)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by material status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="ready">Ready</option>
          <option value="in_process">In Process</option>
          <option value="short">Short</option>
          <option value="held">Held</option>
        </select>
        <label className="materials-v2__search">
          <AppIcon name="search" size={20} />
          <input
            aria-label="Search product or material"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product or material"
          />
        </label>
      </div>

      {materials.length === 0 ? (
        <EmptyState
          title="No readiness items for today"
          body="Add the planned product sequence when approved shift information is available."
        />
      ) : (
        <>
          <div className="materials-v2__table-card">
            <div className="responsive-table">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Seq</th>
                    <th>Product / material</th>
                    <th>Needed by</th>
                    <th>Status</th>
                    <th>Shortage</th>
                    <th>Responsible</th>
                    <th>ETA / expected action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMaterials.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={
                        selectedId === item.id ? "is-selected" : ""
                      }
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setSelectedId(item.id);
                      }}
                    >
                      <td data-label="Line">
                        <strong>{lineLabel(item.production_line_code)}</strong>
                      </td>
                      <td data-label="Seq">{item.sequence_number}</td>
                      <td data-label="Product / material">
                        <strong>{item.product_name}</strong>
                      </td>
                      <td data-label="Needed by">{clock(item.needed_by_at)}</td>
                      <td data-label="Status">
                        <span
                          className={`materials-v2__status is-${item.status}`}
                        >
                          <i aria-hidden="true" />
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td data-label="Shortage">{shortageCopy(item)}</td>
                      <td data-label="Responsible">
                        {responsibleCopy(item)}
                      </td>
                      <td data-label="ETA / expected action">
                        {expectedActionCopy(item)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredMaterials.length === 0 ? (
              <p className="materials-v2__empty-filter">
                No materials match the selected filters.
              </p>
            ) : null}
          </div>

          {selected ? (
            <aside
              className="materials-v2__detail"
              aria-label="Selected material details"
            >
              <header>
                <div className="materials-v2__detail-title">
                  <h2>
                    {selected.product_name} ·{" "}
                    {lineLabel(selected.production_line_code)}
                  </h2>
                  <span
                    className={`materials-v2__status is-${selected.status}`}
                  >
                    <i aria-hidden="true" />
                    {statusLabel(selected.status)}
                  </span>
                </div>
                <div className="materials-v2__detail-actions">
                  <button
                    type="button"
                    className="materials-v2__primary"
                    onClick={() => openEditForm(selected)}
                  >
                    Update status
                  </button>
                  <button
                    type="button"
                    className="materials-v2__outline"
                    onClick={() => onRaiseIssue(selected)}
                  >
                    Raise material issue
                  </button>
                </div>
              </header>

              <div className="materials-v2__facts">
                <article>
                  <strong>{detailShortage(selected)}</strong>
                  <span>Shortage</span>
                </article>
                <article>
                  <strong>Needed by {clock(selected.needed_by_at)}</strong>
                  <span>Needed by</span>
                </article>
                <article>
                  <strong>ETA {clock(selected.expected_available_at)}</strong>
                  <span>Expected available</span>
                </article>
                <article>
                  <strong>Responsible: {responsibleCopy(selected)}</strong>
                  <span>Responsible</span>
                </article>
                <article>
                  <strong>
                    Next action:{" "}
                    {selected.next_action?.trim() ||
                      expectedActionCopy(selected)}
                  </strong>
                  <span>Next action</span>
                </article>
              </div>

              <div className="materials-v2__description">
                <span>Description</span>
                <p>{selected.notes || "No additional description recorded."}</p>
              </div>

              <div className="materials-v2__hold-warning" role="note">
                <span aria-hidden="true">!</span>
                <p>
                  Held materials require authorised QA or management release.
                  Team Leaders cannot release held product.
                </p>
              </div>
            </aside>
          ) : null}
        </>
      )}
    </section>
  );
}
