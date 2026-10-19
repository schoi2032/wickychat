import type {
  Member,
  Message,
  Profile,
  Report,
  Sticker,
  ChatNotification,
} from "./types";

export type LocalAccount = {
  external_id?: string;
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
