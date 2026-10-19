"use client";

import { useState, type FormEvent } from "react";
import type { Profile } from "@/lib/types";
import { errorText, jsonBody, useData, type Api } from "@/lib/client-api";

type WikiPage = { slug: string; title: string; body: string };
export default function WikiPanel({
  api,
  me,
  aiAvailable,
}: {
  api: Api;
  me: Profile;
  aiAvailable: boolean;
}) {
  const pages = useData<WikiPage[]>(api, "/wiki");
  const [slug, setSlug] = useState("");
  const page = useData<WikiPage>(api, slug ? `/wiki/${slug}` : null);
  const [edit, setEdit] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = ["teacher", "moderator", "admin"].includes(me.role);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const saved = await api<WikiPage>(
        `/wiki/${encodeURIComponent(String(data.get("slug")))}`,
        {
          method: "PUT",
          body: jsonBody({ title: data.get("title"), body: data.get("body") }),
        },
      );
      setSlug(saved.slug);
      setEdit(false);
      pages.refresh();
      page.refresh();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ answer: string }>("/wickypedia", {
        method: "POST",
        body: jsonBody({ question: data.get("question") }),
      });
      setAnswer(result.answer);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-page">
      <h1>WICKYpedia</h1>
      <p className="page-description">School knowledge, in one place.</p>
      <section className="plain-section">
        <h2>Ask WICKY</h2>
        <form className="inline-form" onSubmit={ask}>
          <input
            name="question"
            aria-label="Question for WICKYpedia"
            placeholder="Ask a school question…"
            required
            maxLength={1000}
            disabled={!aiAvailable || busy}
          />
          <button className="primary-button" disabled={!aiAvailable || busy}>
            Ask
          </button>
        </form>
        {!aiAvailable && (
          <p className="field-help">
            AI answers and automated moderation are not configured yet. Wiki
            pages and manual sticker review are available.
          </p>
        )}
        {answer && (
          <div className="wiki-answer">
            <span className="label-tag">AI-generated</span>
            <p>{answer}</p>
          </div>
        )}
      </section>
      <section className="plain-section">
        <div className="section-heading">
          <h2>School wiki</h2>
          {canEdit && (
            <button
              className="outline-button"
              onClick={() => {
                setSlug("");
                setEdit(true);
              }}
            >
              New page
            </button>
          )}
        </div>
        {pages.loading ? (
          <p className="muted">Loading pages…</p>
        ) : (
          !pages.data?.length && (
            <p className="muted">
              No pages yet.
              {canEdit
                ? " Add the first school resource."
                : " Your teachers can add school resources here."}
            </p>
          )
        )}
        <div className="wiki-links">
          {pages.data?.map((item) => (
            <button
              className={slug === item.slug ? "selected" : ""}
              key={item.slug}
              onClick={() => {
                setSlug(item.slug);
                setEdit(false);
              }}
            >
              {item.title}
            </button>
          ))}
        </div>
        {edit && canEdit ? (
          <form className="stack-form" onSubmit={save} key={slug}>
            <label>
              Page address
              <input
                name="slug"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                maxLength={100}
                placeholder="school-resources"
                defaultValue={slug}
                required
              />
            </label>
            <label>
              Title
              <input
                name="title"
                maxLength={120}
                defaultValue={page.data?.title || ""}
                required
              />
            </label>
            <label>
              Content
              <textarea
                name="body"
                rows={8}
                maxLength={50000}
                defaultValue={page.data?.body || ""}
                required
              />
            </label>
            <div className="form-actions">
              <button
                className="outline-button"
                type="button"
                onClick={() => setEdit(false)}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                Save page
              </button>
            </div>
          </form>
        ) : (
          page.data && (
            <article className="wiki-article">
              <div className="section-heading">
                <h2>{page.data.title}</h2>
                {canEdit && (
                  <button className="text-button" onClick={() => setEdit(true)}>
                    Edit page
                  </button>
                )}
              </div>
              <p>{page.data.body}</p>
            </article>
          )
        )}
      </section>
      {(error || pages.error || page.error) && (
        <p className="error-notice" role="alert">
          {error || pages.error?.message || page.error?.message}
        </p>
      )}
    </section>
  );
}
