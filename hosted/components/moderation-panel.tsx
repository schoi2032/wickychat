"use client";

import { useState } from "react";
import { errorText, jsonBody, useData, type Api } from "@/lib/client-api";
import type { Message, Person, Profile, Report, Sticker } from "@/lib/types";

type ReviewReport = Report & {
  reporter: Person;
  target: Person | null;
  message: Message | null;
};
export default function ModerationPanel({
  api,
  me,
  onChanged,
}: {
  api: Api;
  me: Profile;
  onChanged: () => void;
}) {
  const reports = useData<ReviewReport[]>(api, "/mod/reports", 5000);
  const stickers = useData<Sticker[]>(api, "/mod/stickers", 5000);
  const [query, setQuery] = useState("");
  const people = useData<Person[]>(
    api,
    me.role === "admin" ? `/users?q=${encodeURIComponent(query)}` : null,
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function act(key: string, path: string, body: unknown) {
    if (busy) return;
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await api(path, { method: "PATCH", body: jsonBody(body) });
      reports.refresh();
      stickers.refresh();
      people.refresh();
      onChanged();
      setNotice("Saved.");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="content-page">
      <h1>Moderation</h1>
      <p className="page-description">
        Review reports and keep shared artwork human-made.
      </p>
      {(error || reports.error || stickers.error || people.error) && (
        <p className="error-notice" role="alert">
          {error ||
            reports.error?.message ||
            stickers.error?.message ||
            people.error?.message}
        </p>
      )}
      {notice && (
        <p role="status" className="success-notice">
          {notice}
        </p>
      )}
      <section className="plain-section">
        <h2>Open reports</h2>
        {!reports.data?.length && (
          <p className="muted">
            {reports.loading ? "Loading reports…" : "No open reports."}
          </p>
        )}
        {reports.data?.map((report) => (
          <article className="review-card" key={report.id}>
            <p>
              <strong>
                {report.target_type === "message"
                  ? "Message report"
                  : "User report"}
              </strong>{" "}
              · {report.target?.name || "Unknown sender"}
            </p>
            {report.message && (
              <blockquote>
                {report.message.body || "Sticker or image message"}
              </blockquote>
            )}
            <p>{report.reason}</p>
            <small className="muted">Reported by {report.reporter.name}</small>
            <div className="form-actions">
              {report.message && (
                <button
                  className="outline-button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void act(
                      `report-${report.id}`,
                      `/mod/reports/${report.id}`,
                      { status: "resolved", hide_message: true },
                    )
                  }
                >
                  Hide message & resolve
                </button>
              )}
              <button
                className="outline-button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void act(`report-${report.id}`, `/mod/reports/${report.id}`, {
                    status: "resolved",
                  })
                }
              >
                Resolve
              </button>
              <button
                className="text-button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void act(`report-${report.id}`, `/mod/reports/${report.id}`, {
                    status: "dismissed",
                  })
                }
              >
                Dismiss
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="plain-section">
        <h2>Sticker & GIF submissions</h2>
        <p className="field-help">
          Check the whole image or GIF before approving. Reject AI-generated
          artwork and inappropriate content.
        </p>
        {!stickers.data?.length && (
          <p className="muted">
            {stickers.loading
              ? "Loading submissions…"
              : "No submissions waiting for review."}
          </p>
        )}
        {stickers.data?.map((sticker) => (
          <article className="review-card" key={sticker.id}>
            {sticker.url && (
              <img
                className="sticker-preview"
                src={sticker.url}
                alt={sticker.name}
              />
            )}
            <p>
              <strong>{sticker.name}</strong>
              {sticker.is_gif && " · GIF"}
            </p>
            <div className="form-actions">
              <button
                className="primary-button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void act(
                    `sticker-${sticker.id}`,
                    `/mod/stickers/${sticker.id}`,
                    { status: "approved" },
                  )
                }
              >
                Approve human-made artwork
              </button>
              <button
                className="outline-button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void act(
                    `sticker-${sticker.id}`,
                    `/mod/stickers/${sticker.id}`,
                    {
                      status: "rejected",
                      reason:
                        "Does not meet school or human-made artwork rules.",
                    },
                  )
                }
              >
                Reject
              </button>
            </div>
          </article>
        ))}
      </section>
      {me.role === "admin" && (
        <section className="plain-section">
          <h2>Account roles</h2>
          <p className="field-help">
            Only assign teacher status to verified teachers. Teachers
            automatically own their chats.
          </p>
          <input
            aria-label="Find an account to manage"
            placeholder="Search accounts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="admin-people">
            {people.data?.map((person) => (
              <div className="admin-person" key={person.id}>
                <span>
                  <strong>{person.name}</strong>
                  <small>{person.email}</small>
                </span>
                <select
                  aria-label={`Role for ${person.name}`}
                  value={person.role}
                  disabled={Boolean(busy)}
                  onChange={(event) =>
                    void act(
                      `role-${person.id}`,
                      `/admin/users/${person.id}/role`,
                      { role: event.target.value },
                    )
                  }
                >
                  {["student", "teacher", "moderator", "admin"].map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
