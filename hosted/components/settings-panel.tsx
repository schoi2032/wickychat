"use client";

import { useState, type FormEvent } from "react";
import type { Profile } from "@/lib/types";
import { errorText, jsonBody, type Api } from "@/lib/client-api";

export default function SettingsPanel({
  me,
  api,
  onSaved,
}: {
  me: Profile;
  api: Api;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await api("/me", {
        method: "PATCH",
        body: jsonBody({
          name: data.get("name"),
          settings: {
            theme: data.get("theme"),
            accent: data.get("accent"),
            font: data.get("font"),
            font_size: Number(data.get("font_size")),
            compact: data.has("compact"),
            enter_to_send: data.has("enter_to_send"),
            show_ai_tags: true,
          },
        }),
      });
      onSaved();
      setNotice("Settings saved.");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-page">
      <h1>Settings</h1>
      <p className="page-description">Make WICKY comfortable for you.</p>
      <form onSubmit={save} className="stack-form settings-form">
        <label>
          Display name
          <input name="name" defaultValue={me.name} required maxLength={80} />
        </label>
        <p className="field-help">
          {me.email} · {me.role}
        </p>
        <div className="form-columns">
          <label>
            Theme
            <select name="theme" defaultValue={me.settings.theme || "light"}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            Accent color
            <input
              type="color"
              name="accent"
              defaultValue={me.settings.accent || "#2862cb"}
            />
          </label>
        </div>
        <div className="form-columns">
          <label>
            Font
            <select name="font" defaultValue={me.settings.font || "Arial"}>
              <option>Arial</option>
              <option>Georgia</option>
              <option>monospace</option>
            </select>
          </label>
          <label>
            Text size
            <select name="font_size" defaultValue={me.settings.font_size || 14}>
              {[12, 14, 16, 18, 20].map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="checkbox-label">
          <input
            name="compact"
            type="checkbox"
            defaultChecked={me.settings.compact}
          />
          Compact message spacing
        </label>
        <label className="checkbox-label">
          <input
            name="enter_to_send"
            type="checkbox"
            defaultChecked={me.settings.enter_to_send !== false}
          />
          Press Enter to send; Shift + Enter for a new line
        </label>
        <button className="primary-button" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        {notice && (
          <p role="status" className="success-notice">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="error-notice">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
