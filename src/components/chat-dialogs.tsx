"use client";

import { useState, type FormEvent } from "react";
import { useData, errorText, jsonBody, type Api } from "@/lib/client-api";
import type { Person, Profile } from "@/lib/types";
import Modal from "./modal";
import { Avatar } from "./ui";

export function CreateChat({
  api,
  me,
  existingMembers,
  chatId,
  onDone,
  onClose,
}: {
  api: Api;
  me: Profile;
  existingMembers?: string[];
  chatId?: string;
  onDone: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Person[]>([]);
  const [notes, setNotes] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const people = useData<Person[]>(
    api,
    `/users?q=${encodeURIComponent(query)}`,
  );
  const candidates = (people.data || []).filter(
    (person) => person.id !== me.id && !existingMembers?.includes(person.id),
  );
  const hasTeacher =
    me.role === "teacher" || chosen.some((person) => person.role === "teacher");
  const tooMany = !chatId && !notes && chosen.length + 1 > 3 && !hasTeacher;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (chatId) {
        if (chosen.length !== 1) throw new Error("Choose one person to add.");
        await api(`/chats/${chatId}/members`, {
          method: "POST",
          body: jsonBody({ user_id: chosen[0].id }),
        });
        onDone(chatId);
      } else {
        if (!notes && !chosen.length)
          throw new Error(
            "Choose someone to chat with, or select notes to yourself.",
          );
        const chat = await api<{ id: string }>("/chats", {
          method: "POST",
          body: jsonBody({
            user_ids: notes ? [] : chosen.map((person) => person.id),
            name: name.trim() || undefined,
          }),
        });
        onDone(chat.id);
      }
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={chatId ? "Add a member" : "New chat"} onClose={onClose}>
      <form className="stack-form" onSubmit={submit}>
        {!chatId && (
          <>
            <label>
              Chat name <span className="muted">(optional)</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder="Give your chat a name"
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={notes}
                onChange={(event) => setNotes(event.target.checked)}
              />
              Notes to myself
            </label>
          </>
        )}
        {!notes && (
          <>
            <label>
              Find people
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or school email"
              />
            </label>
            <div className="people-picker">
              {people.loading ? (
                <p className="muted">Loading people…</p>
              ) : candidates.length === 0 ? (
                <p className="muted">
                  No matching people yet. They appear here after creating an
                  account.
                </p>
              ) : (
                candidates.map((person) => (
                  <label className="person-option" key={person.id}>
                    <input
                      type="checkbox"
                      checked={chosen.some((item) => item.id === person.id)}
                      onChange={(event) =>
                        setChosen((items) =>
                          event.target.checked
                            ? chatId
                              ? [person]
                              : [...items, person]
                            : items.filter((item) => item.id !== person.id),
                        )
                      }
                    />
                    <Avatar initial={person.name[0]} small />
                    <span>
                      <strong>{person.name}</strong>
                      <small>
                        {person.email} · {person.role}
                      </small>
                    </span>
                  </label>
                ))
              )}
            </div>
            <p className="field-help">
              Up to 3 people, including you. Larger chats require a teacher, who
              becomes the owner.
            </p>
          </>
        )}
        {tooMany && (
          <p role="alert" className="error-notice">
            Include a teacher or remove extra people.
          </p>
        )}
        {(error || people.error) && (
          <p className="error-notice" role="alert">
            {error || people.error?.message}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="outline-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy || tooMany}>
            {busy ? "Saving…" : chatId ? "Add member" : "Create chat"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ReportDialog({
  api,
  target,
  onClose,
  onDone,
}: {
  api: Api;
  target: { message_id?: number; user_id?: string; name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/reports", {
        method: "POST",
        body: jsonBody({
          ...(target.message_id
            ? { message_id: target.message_id }
            : { user_id: target.user_id }),
          reason,
        }),
      });
      onDone();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Report ${target.name}`} onClose={onClose}>
      <form className="stack-form" onSubmit={submit}>
        <p className="muted">Your report will go to the moderation team.</p>
        <label>
          What happened?
          <textarea
            required
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
          />
        </label>
        {error && (
          <p role="alert" className="error-notice">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={busy || !reason.trim()}>
          {busy ? "Sending…" : "Submit report"}
        </button>
      </form>
    </Modal>
  );
}

export function UploadSticker({
  api,
  admin,
  onClose,
  onDone,
}: {
  api: Api;
  admin: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 2 * 1024 * 1024) {
      setError("Choose an image or GIF smaller than 2 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/stickers", { method: "POST", body: form });
      onDone();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Upload a sticker or GIF" onClose={onClose}>
      <form onSubmit={submit} className="stack-form">
        <p className="muted">
          Add your own WICKY artwork. Human-made artwork only; submissions are
          reviewed before anyone can send them.
        </p>
        <label>
          Name
          <input name="name" required maxLength={40} />
        </label>
        <label>
          Image or GIF
          <input
            name="file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            required
          />
        </label>
        <label className="checkbox-label">
          <input name="original" type="checkbox" value="true" required />I made
          this artwork without AI, or have permission to use it.
        </label>
        {admin && (
          <label className="checkbox-label">
            <input name="official" type="checkbox" value="true" />
            Official WICKY sticker
          </label>
        )}
        {error && (
          <p className="error-notice" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button" disabled={busy}>
          {busy ? "Uploading…" : "Submit for review"}
        </button>
      </form>
    </Modal>
  );
}
