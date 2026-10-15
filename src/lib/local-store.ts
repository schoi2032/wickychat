import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Member,
  Message,
  Profile,
  Report,
  Sticker,
  ChatNotification,
} from "./types";

export type LocalAccount = {
  profile: Profile;
  salt: string;
  password_hash: string;
};
export type LocalChat = {
  id: string;
  name: string | null;
  kind: "self" | "dm" | "group";
  created_by: string;
  created_at: string;
  last_message_at: string;
  members: (Pick<Member, "id" | "member_role"> & { last_read_id: number })[];
};
export type LocalSticker = Sticker & { mime_type: string };
export type WikiPage = {
  slug: string;
  title: string;
  body: string;
  updated_at: string;
  updated_by: string;
};
export type LocalState = {
  version: 1;
  accounts: LocalAccount[];
  sessions: { hash: string; user_id: string; expires_at: number }[];
  chats: LocalChat[];
  messages: Message[];
  notifications: ChatNotification[];
  reports: Report[];
  stickers: LocalSticker[];
  wiki: WikiPage[];
  next_message_id: number;
  next_report_id: number;
};

export function localDirectory() {
  return (
    process.env.WICKY_LOCAL_DATA_DIR || path.join(process.cwd(), ".local-data")
  );
}

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

// All local API requests share this queue, including during development hot reloads.
// Atomic rename means a stopped process cannot leave half of a JSON document.
const shared = globalThis as typeof globalThis & {
  wickyStoreQueue?: Promise<unknown>;
};
export function withLocalStore<T>(
  change: (state: LocalState) => Promise<T> | T,
  write = false,
): Promise<T> {
  const run = async () => {
    const directory = localDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = path.join(directory, "store.json");
    let state: LocalState;
    try {
      state = JSON.parse(await readFile(filename, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = emptyState();
    }
    const result = await change(state);
    if (write) {
      const temporary = path.join(directory, `store-${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary, filename);
    }
    return result;
  };
  const next = (shared.wickyStoreQueue || Promise.resolve()).then(run, run);
  shared.wickyStoreQueue = next.catch(() => {});
  return next;
}
