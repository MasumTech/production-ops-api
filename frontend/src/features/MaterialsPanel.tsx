import { useState } from "react";

import { OfflineQueuedError, postJson } from "../api";
import {
  AssignmentSelect,
  EmptyState,
  ErrorBanner,
  PageIntro,
  StatusPill,
  SubmitButton,
  UserSelect,
} from "../components";
import { formatDateTime, toIso } from "../format";
import type { Assignment, MaterialReadiness, UserChoice } from "../types";

export function MaterialsPanel({
  assignments,
  materials,
  users,
  onSaved,
}: {
  assignments: Assignment[];
  materials: MaterialReadiness[];
  users: UserChoice[];
  onSaved: (message: string) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<MaterialReadiness["status"] | "all">("all");
  const [activeTab, setActiveTab] = useState<"materials" | "actions">("materials");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [assignment, setAssignment] = useState("");
  const [sequence, setSequence] = useState("1");
  const [productCode, setProductCode] = useState("");
  const [productName, setProductName] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState("0");
  const [status, setStatus] = useState("ready");
  const [shortageQuantity, setShortageQuantity] = useState("0");
  const [owner, setOwner] = useState("");
  const [expectedAvailable, setExpectedAvailable] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postJson<MaterialReadiness>("/product-material-readiness/", {
        assignment: Number(assignment),
        sequence_number: Number(sequence),
        product_code: productCode.trim(),
        product_name: productName.trim(),
        planned_quantity: Number(plannedQuantity),
        status,
        shortage_quantity: status === "short" ? Number(shortageQuantity) : 0,
        owner: owner ? Number(owner) : null,
        expected_available_at: status === "short" ? toIso(expectedAvailable) : null,
        hold_reason: status === "held" ? holdReason.trim() : "",
        notes: notes.trim(),
      });
      await onSaved("Material readiness item added.");
      setProductCode("");
      setProductName("");
      setNotes("");
      setShowForm(false);
    } catch (caught) {
      if (caught instanceof OfflineQueuedError) {
        await onSaved(caught.message);
        setProductCode("");
        setProductName("");
        setNotes("");
        setShowForm(false);
      } else {
        setError(caught instanceof Error ? caught.message : "Could not add the material item.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <PageIntro
        eyebrow="Forward risk"
        title="Product & material readiness"
        body="See the running sequence and make Short or Held risks visible before they stop the line."
        action={
          <button className="button button--primary" onClick={() => setShowForm((value) => !value)}>
            {showForm ? "Close form" : "Add item"}
          </button>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}
      <div className="materials-tabs" role="tablist" aria-label="Materials workspace">
        <button className={activeTab === "materials" ? "is-active" : ""} onClick={() => setActiveTab("materials")} role="tab">Materials <strong>{materials.length}</strong></button>
        <button className={activeTab === "actions" ? "is-active" : ""} onClick={() => setActiveTab("actions")} role="tab">Open actions</button>
      </div>
      {activeTab === "materials" ? <div className="material-status-cards" aria-label="Filter by material status">
        {([["all", "All", materials.length], ["ready", "Ready", materials.filter((item) => item.status === "ready").length], ["in_process", "In process", materials.filter((item) => item.status === "in_process").length], ["short", "Short", materials.filter((item) => item.status === "short").length], ["held", "Held", materials.filter((item) => item.status === "held").length]] as const).map(([key, label, count]) => <button key={key} className={filter === key ? "is-selected" : ""} onClick={() => setFilter(key)}><span>{label}</span><strong>{count}</strong></button>)}
      </div> : <div className="materials-action-note">Open actions are grouped from Short and Held records. Select a material to review the next action.</div>}

      {showForm ? (
        <form className="form-card form-grid form-card--spaced" onSubmit={save}>
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
              type="number"
              min="1"
              value={sequence}
              onChange={(event) => setSequence(event.target.value)}
              required
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="ready">Ready</option>
              <option value="in_process">In Process</option>
              <option value="short">Short</option>
              <option value="held">Held</option>
            </select>
          </label>
          <label>
            Product code
            <input value={productCode} onChange={(event) => setProductCode(event.target.value)} required />
          </label>
          <label>
            Product name
            <input value={productName} onChange={(event) => setProductName(event.target.value)} required />
          </label>
          <label>
            Planned quantity
            <input
              type="number"
              min="0"
              value={plannedQuantity}
              onChange={(event) => setPlannedQuantity(event.target.value)}
              required
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
                  type="number"
                  min="1"
                  value={shortageQuantity}
                  onChange={(event) => setShortageQuantity(event.target.value)}
                  required
                />
              </label>
              <label>
                Expected available
                <input
                  type="datetime-local"
                  value={expectedAvailable}
                  onChange={(event) => setExpectedAvailable(event.target.value)}
                  required
                />
              </label>
            </>
          ) : null}
          {status === "held" ? (
            <label className="span-2">
              Hold reason
              <textarea
                value={holdReason}
                onChange={(event) => setHoldReason(event.target.value)}
                rows={3}
                required
              />
            </label>
          ) : null}
          <label className="span-2">
            Notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
          </label>
          <div className="form-actions span-2">
            <SubmitButton busy={busy}>Add readiness item</SubmitButton>
          </div>
        </form>
      ) : null}

      {materials.length === 0 ? (
        <EmptyState
          title="No readiness items for today"
          body="Add the planned product sequence when approved shift information is available."
        />
      ) : (
        <>
        <div className="table-card">
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Seq</th>
                  <th>Line</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Risk / owner</th>
                  <th>Expected</th>
                </tr>
              </thead>
              <tbody>
                {materials.filter((item) => filter === "all" || item.status === filter).map((item) => (
                  <tr key={item.id} onClick={() => setSelectedId(item.id)} className={selectedId === item.id ? "is-selected" : ""} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(item.id); }}>
                    <td data-label="Seq">{item.sequence_number}</td>
                    <td data-label="Line">{item.production_line_code}</td>
                    <td data-label="Product">
                      <strong>{item.product_code}</strong>
                      <span>{item.product_name}</span>
                    </td>
                    <td data-label="Status">
                      <StatusPill value={item.status} />
                    </td>
                    <td data-label="Risk / owner">
                      {item.status === "short" ? `${item.shortage_quantity} short` : item.hold_reason || "—"}
                      <span>{item.owner_username || "No owner"}</span>
                    </td>
                    <td data-label="Expected">{formatDateTime(item.expected_available_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {selectedId !== null ? (() => { const item = materials.find((candidate) => candidate.id === selectedId); return item ? <aside className="material-detail-card" aria-label="Selected material details"><div><span className="eyebrow">Selected item</span><h2>{item.product_name} · {item.production_line_code}</h2><StatusPill value={item.status} /></div><dl><div><dt>Needed by</dt><dd>{formatDateTime(item.expected_available_at)}</dd></div><div><dt>Shortage</dt><dd>{item.shortage_quantity ? `${item.shortage_quantity} units` : "None recorded"}</dd></div><div><dt>Responsible</dt><dd>{item.owner_username || "Unassigned"}</dd></div><div><dt>Held reason</dt><dd>{item.hold_reason || "—"}</dd></div></dl><div className="form-actions"><button className="button button--primary" onClick={() => setShowForm(true)}>Update status</button><button className="button button--ghost" onClick={() => setShowForm(true)}>Raise issue</button></div></aside> : null; })() : null}
        </>
      )}
    </section>
  );
}
