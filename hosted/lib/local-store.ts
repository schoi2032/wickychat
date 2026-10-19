import { env } from "cloudflare:workers";
import { ApiError } from "./api";
import type { LocalState } from "./store-types";
export type {
  LocalAccount,
  LocalChat,
  LocalState,
  LocalSticker,
  WikiPage,
} from "./store-types";

function emptyState(): LocalState {
  return {
    version: 1,
    accounts: [],
    sessions: [],
    chats: [],
    messages: [],
    notifications: [],
    reports: [],
    stickers: [],
    wiki: [],
    next_message_id: 1,
    next_report_id: 1,
  };
}

// Compare-and-swap prevents concurrent server instances from losing each other's changes.
// Read-only polls do not rewrite the database when no account or record changed.
export async function withLocalStore<T>(
  change: (state: LocalState) => Promise<T> | T,
  write = false,
): Promise<T> {
  const db = env.DB;
  if (!db)
    throw new ApiError(
      503,
      "storage_unavailable",
      "Workspace storage is not ready yet.",
    );
  for (let attempt = 0; attempt < 8; attempt++) {
    const stored = await db
      .prepare("SELECT revision, payload FROM wicky_workspace WHERE id = 1")
      .first<{ revision: number; payload: string }>();
    const state: LocalState = stored
      ? JSON.parse(stored.payload)
      : emptyState();
    const before = JSON.stringify(state);
    const result = await change(state);
    const payload = JSON.stringify(state);
    if (!write || (stored && payload === before)) return result;
    const saved = stored
      ? await db
          .prepare(
            "UPDATE wicky_workspace SET payload = ?, revision = revision + 1 WHERE id = 1 AND revision = ?",
          )
          .bind(payload, stored.revision)
          .run()
      : await db
          .prepare(
            "INSERT OR IGNORE INTO wicky_workspace (id, revision, payload) VALUES (1, 1, ?)",
          )
          .bind(payload)
          .run();
    if (saved.meta.changes === 1) return result;
  }
  throw new ApiError(
    409,
    "try_again",
    "Another update arrived at the same time. Please try again.",
  );
}
export async function writeAsset(
  id: string,
  bytes: Uint8Array,
  mimeType: string,
) {
  if (!env.BUCKET)
    throw new ApiError(
      503,
      "storage_unavailable",
      "File storage is not ready yet.",
    );
  await env.BUCKET.put(`stickers/${id}`, bytes, {
    httpMetadata: { contentType: mimeType },
  });
}
export async function readAsset(id: string) {
  const object = await env.BUCKET?.get(`stickers/${id}`);
  if (!object)
    throw new ApiError(404, "not_found", "This file is not available.");
  return new Uint8Array(await object.arrayBuffer());
}
