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
                {materials.map((item) => (
                  <tr key={item.id}>
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
      )}
    </section>
  );
}
