import { useEffect, useState, type FormEvent } from "react";

import { ApiError, apiRequest } from "./api";
import type { UserSummary } from "./types";

export function ProfileEditor({
  profile,
  open,
  onClose,
  onSaved,
}: {
  profile: UserSummary;
  open: boolean;
  onClose: () => void;
  onSaved: (profile: UserSummary) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setFirstName(profile.first_name ?? "");
    setLastName(profile.last_name ?? "");
    setUsername(profile.username);
    setEmail(profile.email ?? "");
    setPhoneNumber(profile.phone_number ?? "");
    setError("");
  }, [open, profile]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open, saving]);

  if (!open) return null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const updated = await apiRequest<UserSummary>("/auth/me/", {
        method: "PATCH",
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          username: username.trim(),
          email: email.trim(),
          phone_number: phoneNumber.trim(),
        }),
      });
      onSaved(updated);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not update your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-editor-backdrop" role="presentation">
      <section className="profile-editor" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
        <header>
          <div>
            <span className="eyebrow">Personal account</span>
            <h2 id="profile-editor-title">Edit your profile</h2>
            <p>Keep your contact details accurate for shift communication.</p>
          </div>
          <button type="button" aria-label="Close profile editor" onClick={onClose}>×</button>
        </header>
        <form onSubmit={save}>
          <div className="profile-editor__grid">
            <label>First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" /></label>
            <label>Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" /></label>
            <label className="profile-editor__wide">Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
            <label className="profile-editor__wide">Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
            <label className="profile-editor__wide">Phone number<input type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} autoComplete="tel" placeholder="+44 7700 900000" /></label>
          </div>
          {error ? <p className="profile-editor__error" role="alert">{error}</p> : null}
          <footer>
            <button type="button" className="button button--ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="button button--primary" disabled={saving || !username.trim()}>{saving ? "Saving…" : "Save profile"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
