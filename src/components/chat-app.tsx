"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type { AppMode } from "@/lib/app-mode";
import {
  errorText,
  HttpError,
  jsonBody,
  makeApi,
  useData,
} from "@/lib/client-api";
import { REACTIONS } from "@/lib/chat-rules";
import type {
  ChatNotification,
  HomeChat,
  Importance,
  Member,
  Message,
  Person,
  Profile,
  Sticker,
} from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/browser";
import AccountForm from "./account-form";
import { CreateChat, ReportDialog, UploadSticker } from "./chat-dialogs";
import Modal from "./modal";
import SettingsPanel from "./settings-panel";
import WikiPanel from "./wiki-panel";
import ModerationPanel from "./moderation-panel";
import { Avatar, Icon, IconButton, type IconName } from "./ui";

type HomeData = {
  me: Profile;
  chats: HomeChat[];
  people: Person[];
  total_unread: number;
};
type ChatDetail = {
  id: string;
  name: string | null;
  kind: string;
  members: Member[];
  my_role: string;
};
type View =
  "home" | "chat" | "notifications" | "wiki" | "settings" | "moderation";
const labels: Record<Importance, string> = {
  important: "IMPORTANT",
  slightly_important: "SLIGHTLY IMPORTANT",
  unimportant: "UNIMPORTANT",
};
const formatTime = (date: string) =>
  new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const formatDate = (date: string) =>
  new Date(date).toLocaleDateString([], { month: "short", day: "numeric" });

export default function ChatApp({
  mode,
  aiAvailable,
}: {
  mode: AppMode;
  aiAvailable: boolean;
}) {
  const api = useMemo(
    () => makeApi(mode === "local" ? "/api/local" : "/api"),
    [mode],
  );
  const home = useData<HomeData>(api, mode === "setup" ? null : "/home", 2500);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("home");
  const [search, setSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [createChat, setCreateChat] = useState(false);
  const [addMember, setAddMember] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showStickers, setShowStickers] = useState(false);
  const [uploadSticker, setUploadSticker] = useState(false);
  const [report, setReport] = useState<{
    message_id?: number;
    user_id?: string;
    name: string;
  } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [importance, setImportance] = useState<Importance>("unimportant");
  const [aiTagged, setAiTagged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [olderMessages, setOlderMessages] = useState<{
    chat: string;
    messages: Message[];
  }>({ chat: "", messages: [] });
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const lastRead = useRef("");
  const chatPath =
    activeId && view === "chat" && home.data ? `/chats/${activeId}` : null;
  const detail = useData<ChatDetail>(api, chatPath, 5000);
  const messages = useData<{ messages: Message[]; has_more: boolean }>(
    api,
    chatPath
      ? `${chatPath}/messages?limit=100&q=${encodeURIComponent(messageSearch)}`
      : null,
    2000,
  );
  const notifications = useData<ChatNotification[]>(
    api,
    home.data ? "/notifications" : null,
    4000,
  );
  const stickers = useData<Sticker[]>(
    api,
    showStickers && home.data ? "/stickers" : null,
    5000,
  );
  const submissions = useData<Sticker[]>(
    api,
    showStickers && home.data ? "/stickers?mine=1" : null,
    5000,
  );
  const me = home.data?.me;
  const active = home.data?.chats.find((chat) => chat.chat_id === activeId);
  const newest = messages.data?.messages.at(-1)?.id;
  const nameOf = useCallback(
    (id: string | null) =>
      id === me?.id
        ? me.name
        : id
          ? home.data?.people.find((person) => person.id === id)?.name ||
            "Member"
          : "WICKYpedia",
    [home.data?.people, me],
  );
  const chatName = (chat: HomeChat) =>
    chat.name ||
    (chat.kind === "self"
      ? "Notes to myself"
      : chat.member_ids
          .filter((id) => id !== me?.id)
          .map(nameOf)
          .join(", ") || "Chat");
  const openChat = (id: string) => {
    setActiveId(id);
    setView("chat");
    setError("");
    setMessageSearch("");
    setShowMessageSearch(false);
    setShowStickers(false);
  };
  const refreshAll = useCallback(() => {
    home.refresh();
    detail.refresh();
    messages.refresh();
    notifications.refresh();
  }, [home.refresh, detail.refresh, messages.refresh, notifications.refresh]);

  useEffect(() => {
    if (historyRef.current)
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [newest, activeId]);
  useEffect(() => {
    if (
      !activeId ||
      !newest ||
      messageSearch ||
      view !== "chat" ||
      document.hidden
    )
      return;
    const key = `${activeId}:${newest}`;
    if (lastRead.current === key) return;
    let stopped = false;
    void api(`/chats/${activeId}/read`, {
      method: "POST",
      body: jsonBody({ last_message_id: newest }),
    })
      .then(() => {
        if (!stopped) {
          lastRead.current = key;
          home.refresh();
          notifications.refresh();
        }
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [
    activeId,
    newest,
    messages.data,
    messageSearch,
    view,
    api,
    home.refresh,
    notifications.refresh,
  ]);
  useEffect(() => {
    if (mode !== "supabase" || !me?.id) return;
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`wicky-${me.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        refreshAll,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_members" },
        refreshAll,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [mode, me?.id, refreshAll]);

  async function send(event?: FormEvent, stickerId?: string) {
    event?.preventDefault();
    if (!activeId || busy) return;
    const body = (drafts[activeId] || "").trim();
    if (!stickerId && !body) return;
    const chatId = activeId;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ moderation?: { censored?: boolean } }>(
        `/chats/${chatId}/messages`,
        {
          method: "POST",
          body: jsonBody(
            stickerId
              ? { sticker_id: stickerId, importance }
              : { body, importance, ai_generated: aiTagged },
          ),
        },
      );
      if (!stickerId) setDrafts((current) => ({ ...current, [chatId]: "" }));
      setShowStickers(false);
      setAiTagged(false);
      if (result.moderation?.censored)
        setNotice("Sent. Swear words were censored.");
      refreshAll();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function react(message: Message, emoji: string) {
    try {
      await api(`/messages/${message.id}/reactions`, {
        method: "POST",
        body: jsonBody({ emoji }),
      });
      messages.refresh();
    } catch (error) {
      setError(errorText(error));
    }
  }
  async function loadOlder() {
    if (!activeId || historyBusy || !messages.data) return;
    const current =
      olderMessages.chat === activeId ? olderMessages.messages : [];
    const before = current[0]?.id || messages.data.messages[0]?.id;
    setHistoryBusy(true);
    try {
      const result = await api<{ messages: Message[] }>(
        `/chats/${activeId}/messages?before=${before}&limit=100&q=${encodeURIComponent(messageSearch)}`,
      );
      setOlderMessages({
        chat: activeId,
        messages: [...result.messages, ...current],
      });
      if (!result.messages.length)
        setNotice("You have reached the start of the conversation.");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setHistoryBusy(false);
    }
  }
  async function renameChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeId) return;
    const name = new FormData(event.currentTarget).get("name");
    try {
      await api(`/chats/${activeId}`, {
        method: "PATCH",
        body: jsonBody({ name: String(name).trim() || null }),
      });
      refreshAll();
      setNotice("Chat name saved.");
    } catch (error) {
      setError(errorText(error));
    }
  }
  async function removeMember(member: Member) {
    if (
      !activeId ||
      !window.confirm(
        member.id === me?.id
          ? "Leave this chat?"
          : `Remove ${member.name} from this chat?`,
      )
    )
      return;
    try {
      await api(`/chats/${activeId}/members/${member.id}`, {
        method: "DELETE",
      });
      if (member.id === me?.id) {
        setActiveId(null);
        setView("home");
        setShowMembers(false);
      }
      refreshAll();
    } catch (error) {
      setError(errorText(error));
    }
  }
  async function logout() {
    try {
      if (mode === "local")
        await api("/auth/logout", { method: "POST", body: "{}" });
      else {
        const { error } = await supabaseBrowser().auth.signOut();
        if (error) throw error;
      }
      window.location.reload();
    } catch (error) {
      setError(errorText(error));
    }
  }
  if (
    mode === "setup" ||
    (home.error instanceof HttpError && home.error.status === 401)
  )
    return <AccountForm api={api} mode={mode} onReady={home.refresh} />;
  if (!me)
    return (
      <main className="account-screen">
        <section className="account-card">
          <div className="brand">
            <span className="brand-mark">w</span>WICKY
          </div>
          {home.error ? (
            <>
              <p className="error-notice" role="alert">
                {home.error.message}
              </p>
              <button className="primary-button" onClick={home.refresh}>
                Try again
              </button>
            </>
          ) : (
            <p className="muted">Opening your workspace…</p>
          )}
        </section>
      </main>
    );

  const filteredChats = home.data!.chats.filter((chat) =>
    `${chatName(chat)} ${chat.last_message?.body || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const canManage = ["owner", "manager"].includes(detail.data?.my_role || "");
  const isModerator = ["admin", "moderator"].includes(me.role);
  const allMessages = [
    ...(olderMessages.chat === activeId && !messageSearch
      ? olderMessages.messages
      : []),
    ...(messages.data?.messages || []),
  ].filter(
    (message, index, list) =>
      list.findIndex((item) => item.id === message.id) === index,
  );
  const style = {
    "--blue": me.settings.accent || "#2862cb",
    "--chat-font": me.settings.font || "Arial",
    "--message-size": `${me.settings.font_size || 14}px`,
  } as CSSProperties;
  const unreadNotifications =
    notifications.data?.filter((item) => !item.read_at).length || 0;
  const nav: { view: View; icon: IconName; label: string }[] = [
    { view: "home", icon: "home", label: "Home" },
    { view: "chat", icon: "message", label: "Messages" },
    { view: "wiki", icon: "info", label: "WICKYpedia" },
    { view: "settings", icon: "more", label: "Settings" },
    ...(isModerator
      ? [
          {
            view: "moderation" as View,
            icon: "shield" as IconName,
            label: "Moderation",
          },
        ]
      : []),
  ];
  const memberPanel = (
    <>
      <div className="section-heading">
        <h2>Members</h2>
        <span className="section-count">
          {detail.data?.members.length || 0}
        </span>
      </div>
      {detail.error && (
        <p role="alert" className="error-notice">
          {detail.error.message}
        </p>
      )}
      <ul className="member-list">
        {detail.data?.members.map((member) => (
          <li key={member.id}>
            <Avatar initial={member.name[0]} small />
            <span className="member-name">
              <strong>
                {member.name}
                {member.id === me.id ? " (you)" : ""}
              </strong>
              <small>
                {member.role}
                {member.member_role !== "member"
                  ? ` · ${member.member_role}`
                  : ""}
              </small>
            </span>
            {member.id !== me.id && (
              <button
                className="text-button"
                onClick={() =>
                  setReport({ user_id: member.id, name: member.name })
                }
              >
                Report
              </button>
            )}
            {canManage &&
              member.id !== me.id &&
              member.member_role !== "owner" &&
              (member.role !== "teacher" || me.role === "teacher") && (
                <button
                  className="text-button danger"
                  onClick={() => void removeMember(member)}
                >
                  Remove
                </button>
              )}
          </li>
        ))}
      </ul>
      {canManage && detail.data?.kind !== "self" && (
        <button
          className="outline-button full-width"
          onClick={() => setAddMember(true)}
        >
          <Icon name="plus" />
          Add a member
        </button>
      )}
      {canManage && (
        <form
          className="stack-form rename-form"
          onSubmit={renameChat}
          key={activeId}
        >
          <label>
            Chat name
            <input
              name="name"
              maxLength={80}
              defaultValue={active?.name || ""}
            />
          </label>
          <button className="outline-button">Save name</button>
        </form>
      )}
      {active && (
        <button
          className="text-button danger"
          onClick={() => {
            const member = detail.data?.members.find(
              (item) => item.id === me.id,
            );
            if (member) void removeMember(member);
          }}
        >
          Leave chat
        </button>
      )}
      <p className="field-help">
        3 people maximum unless a teacher is present. Teachers own chats they
        join.
      </p>
    </>
  );

  return (
    <div
      className={`chat-app${me.settings.compact ? " compact" : ""}`}
      style={style}
      data-theme={me.settings.theme || "light"}
    >
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setView("home")}
          aria-label="WICKY home"
        >
          <span className="brand-mark">w</span>
          <span>WICKY</span>
        </button>
        <div className="topbar-content">
          <div className="search-field">
            <Icon name="search" />
            <input
              aria-label="Search your chats"
              placeholder="Search your chats…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="topbar-profile">
            {mode === "local" && (
              <span className="local-label">Local workspace</span>
            )}
            <button
              className="icon-button notification-button"
              aria-label={`Notifications, ${unreadNotifications} unread`}
              onClick={() => setView("notifications")}
            >
              <Icon name="bell" />
              {unreadNotifications > 0 && <span className="notification-dot" />}
            </button>
            <button
              className="profile-button"
              onClick={() => setView("settings")}
              aria-label="Your profile and settings"
            >
              <Avatar initial={me.name[0]} small />
              <span className="profile-name">{me.name}</span>
            </button>
          </div>
        </div>
      </header>
      <div
        className={`workspace${view !== "chat" || !active ? " workspace-wide" : ""}`}
      >
        <aside className="sidebar" aria-label="Chats and navigation">
          <nav className="main-navigation" aria-label="Main navigation">
            {nav.map((item) => (
              <button
                key={item.view}
                className={view === item.view ? "selected" : ""}
                onClick={() => setView(item.view)}
                title={item.label}
                aria-current={view === item.view ? "page" : undefined}
              >
                <Icon name={item.icon} />
                <span className="nav-label">{item.label}</span>
                {item.view === "home" && home.data!.total_unread > 0 && (
                  <span className="count-badge">{home.data!.total_unread}</span>
                )}
              </button>
            ))}
          </nav>
          <section className="groups-section">
            <div className="section-heading">
              <h2 className="sidebar-section-title">Your chats</h2>
              <IconButton
                name="plus"
                label="New chat"
                onClick={() => setCreateChat(true)}
              />
            </div>
            {filteredChats.length ? (
              <ul className="group-list">
                {filteredChats.map((chat) => (
                  <li key={chat.chat_id}>
                    <button
                      className={`group-button${view === "chat" && activeId === chat.chat_id ? " selected" : ""}`}
                      onClick={() => openChat(chat.chat_id)}
                      title={chatName(chat)}
                    >
                      <Avatar
                        initial={
                          chat.kind === "self" ? me.name[0] : chatName(chat)[0]
                        }
                        small
                      />
                      <span className="group-label">
                        <span>{chatName(chat)}</span>
                        <span className="group-members">
                          {chat.last_message?.body ||
                            (chat.kind === "self"
                              ? "Your private notes"
                              : `${chat.member_ids.length} members`)}
                        </span>
                      </span>
                      {chat.unread_count > 0 && (
                        <span className="count-badge">{chat.unread_count}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sidebar-empty">
                {search ? "No matching chats." : "No chats yet."}
              </p>
            )}
          </section>
          <div className="sidebar-footer">
            <button
              className="profile-button"
              onClick={() => setView("settings")}
              title={me.name}
            >
              <Avatar initial={me.name[0]} small />
              <span className="sidebar-profile">
                <strong>{me.name}</strong>
                <small>{me.role}</small>
              </span>
            </button>
            <button
              className="text-button signout"
              onClick={() => void logout()}
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        </aside>
        <main className="conversation">
          {(error || notice || (home.error && home.data)) && (
            <div
              className={`app-notice ${error || home.error ? "error-notice" : "success-notice"}`}
              role={error || home.error ? "alert" : "status"}
            >
              <span>{error || home.error?.message || notice}</span>
              <button
                aria-label="Dismiss notice"
                className="icon-button"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                ×
              </button>
            </div>
          )}
          {view === "home" && (
            <section className="content-page">
              <div className="page-heading">
                <div>
                  <h1>Home</h1>
                  <p className="page-description">
                    {home.data!.total_unread
                      ? `${home.data!.total_unread} unread message${home.data!.total_unread === 1 ? "" : "s"}`
                      : "You’re all caught up."}
                  </p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setCreateChat(true)}
                >
                  <Icon name="plus" />
                  New chat
                </button>
              </div>
              <h2 className="list-heading">Your conversations</h2>
              {!filteredChats.length ? (
                <div className="empty-state">
                  <Icon name="message" />
                  <h2>
                    {search
                      ? "No matching chats"
                      : "Your conversations start here"}
                  </h2>
                  <p>
                    {search
                      ? "Try another name or search term."
                      : "Create a chat with someone from school, or keep notes to yourself."}
                  </p>
                  {!search && (
                    <button
                      className="outline-button"
                      onClick={() => setCreateChat(true)}
                    >
                      Create your first chat
                    </button>
                  )}
                </div>
              ) : (
                <ul className="home-chat-list">
                  {filteredChats.map((chat) => (
                    <li key={chat.chat_id}>
                      <button onClick={() => openChat(chat.chat_id)}>
                        <Avatar initial={chatName(chat)[0]} />
                        <span className="home-chat-copy">
                          <strong>
                            {chatName(chat)}
                            {(chat.notification_priority || 0) >= 100 && (
                              <span className="label-tag">Teacher message</span>
                            )}
                          </strong>
                          <span>
                            {chat.last_message?.body || "No messages yet"}
                          </span>
                        </span>
                        <span className="home-chat-meta">
                          <time>{formatDate(chat.last_message_at)}</time>
                          {chat.unread_count > 0 && (
                            <span className="count-badge">
                              {chat.unread_count}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {view === "chat" && !active && (
            <div className="empty-state">
              <Icon name="message" />
              <h1>
                {home.data!.chats.length
                  ? "Choose a conversation"
                  : "No chats yet"}
              </h1>
              <p>Select a chat from the sidebar or create your own.</p>
              <button
                className="primary-button"
                onClick={() => setCreateChat(true)}
              >
                New chat
              </button>
            </div>
          )}
          {view === "chat" && active && (
            <>
              <header className="conversation-header">
                <Avatar initial={chatName(active)[0]} />
                <div className="conversation-heading">
                  <h1>{chatName(active)}</h1>
                  <p>
                    {active.kind === "self"
                      ? "Only you can see these notes"
                      : `${active.member_ids.length} members`}
                  </p>
                </div>
                <div className="conversation-actions">
                  <IconButton
                    name="search"
                    label="Search messages"
                    onClick={() => setShowMessageSearch((value) => !value)}
                  />
                  <IconButton
                    name="users"
                    label="View chat members"
                    onClick={() => setShowMembers(true)}
                  />
                </div>
              </header>
              {showMessageSearch && (
                <div className="message-search">
                  <input
                    aria-label="Search messages"
                    placeholder="Search this conversation…"
                    value={messageSearch}
                    onChange={(event) => setMessageSearch(event.target.value)}
                  />
                  <button
                    className="text-button"
                    onClick={() => {
                      setShowMessageSearch(false);
                      setMessageSearch("");
                    }}
                  >
                    Close
                  </button>
                </div>
              )}
              <div
                ref={historyRef}
                className="message-history"
                aria-label="Conversation messages"
              >
                {messages.error && (
                  <p className="error-notice" role="alert">
                    {messages.error.message}
                  </p>
                )}
                {messages.loading ? (
                  <p className="muted">Loading messages…</p>
                ) : allMessages.length === 0 ? (
                  <div className="empty-state">
                    <Icon name="message" />
                    <h2>
                      {messageSearch
                        ? "No matching messages"
                        : "No messages yet"}
                    </h2>
                    <p>
                      {messageSearch
                        ? "Try a different search."
                        : active.kind === "self"
                          ? "A place for your notes, ideas, and reminders."
                          : "Send the first message when you’re ready."}
                    </p>
                  </div>
                ) : (
                  <>
                    {messages.data?.has_more && (
                      <button
                        className="history-button text-button"
                        onClick={() => void loadOlder()}
                        disabled={historyBusy}
                      >
                        {historyBusy ? "Loading…" : "Load earlier messages"}
                      </button>
                    )}
                    <ol className="messages">
                      {allMessages.map((message) => (
                        <li
                          className={`message${message.user_id === me.id ? " message-own" : ""}`}
                          key={message.id}
                        >
                          <Avatar initial={nameOf(message.user_id)[0]} small />
                          <div className="message-content">
                            <div className="message-meta">
                              <strong>
                                {nameOf(message.user_id)}
                                {home.data!.people.find(
                                  (person) => person.id === message.user_id,
                                )?.role === "teacher" && (
                                  <span className="label-tag">Teacher</span>
                                )}
                              </strong>
                              <time
                                title={new Date(
                                  message.created_at,
                                ).toLocaleString()}
                              >
                                {formatDate(message.created_at)} ·{" "}
                                {formatTime(message.created_at)}
                              </time>
                            </div>
                            <div
                              className={`message-bubble${message.status === "hidden" ? " message-hidden" : ""}`}
                            >
                              {message.status === "hidden" ? (
                                <p>Message removed by moderation.</p>
                              ) : (
                                <>
                                  {message.importance && (
                                    <span
                                      className={`importance-tag importance-${message.importance}`}
                                    >
                                      {labels[message.importance]}
                                    </span>
                                  )}
                                  {message.ai_tag && (
                                    <span className="label-tag">
                                      {message.ai_tag === "bot"
                                        ? "AI-generated"
                                        : message.ai_tag === "likely_ai"
                                          ? "Possibly AI-generated"
                                          : "AI-assisted"}
                                    </span>
                                  )}
                                  {message.body && <p>{message.body}</p>}
                                  {message.sticker_url && (
                                    <img
                                      className="message-image"
                                      src={message.sticker_url}
                                      alt="Shared sticker or GIF"
                                    />
                                  )}
                                  {message.image_url && (
                                    <img
                                      className="message-image"
                                      src={message.image_url}
                                      alt={message.body || "Shared image"}
                                    />
                                  )}
                                </>
                              )}
                            </div>
                            {message.status === "visible" && (
                              <div className="message-tools">
                                <div
                                  className="reaction-options"
                                  aria-label="Reactions — one per person"
                                >
                                  {REACTIONS.map((emoji) => {
                                    const count =
                                      message.reactions?.filter(
                                        (reaction) => reaction.emoji === emoji,
                                      ).length || 0;
                                    const mine = message.reactions?.some(
                                      (reaction) =>
                                        reaction.emoji === emoji &&
                                        reaction.user_id === me.id,
                                    );
                                    return (
                                      <button
                                        className={
                                          mine
                                            ? "reaction selected"
                                            : "reaction"
                                        }
                                        key={emoji}
                                        aria-label={`React ${emoji}${count ? `, ${count} reactions` : ""}`}
                                        aria-pressed={Boolean(mine)}
                                        onClick={() =>
                                          void react(message, emoji)
                                        }
                                      >
                                        {emoji}
                                        {count > 0 && <span>{count}</span>}
                                      </button>
                                    );
                                  })}
                                </div>
                                <button
                                  className="message-report text-button"
                                  onClick={() =>
                                    setReport({
                                      message_id: message.id,
                                      name: "message",
                                    })
                                  }
                                >
                                  Report
                                </button>
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </div>
              <footer className="composer-area">
                <form onSubmit={(event) => void send(event)}>
                  <div className="composer-options">
                    <label>
                      Tag
                      <select
                        aria-label="Message importance"
                        value={importance}
                        onChange={(event) =>
                          setImportance(event.target.value as Importance)
                        }
                      >
                        {Object.entries(labels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={aiTagged}
                        onChange={(event) => setAiTagged(event.target.checked)}
                      />
                      AI-assisted
                    </label>
                  </div>
                  <div className="composer">
                    <IconButton
                      name="smile"
                      label="Stickers and GIFs"
                      onClick={() => setShowStickers(true)}
                    />
                    <textarea
                      aria-label="Message"
                      placeholder={
                        active.kind === "self"
                          ? "Write a note…"
                          : `Message ${chatName(active)}…`
                      }
                      value={drafts[activeId!] || ""}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [activeId!]: event.target.value,
                        }))
                      }
                      rows={1}
                      maxLength={4000}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing &&
                          me.settings.enter_to_send !== false
                        ) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <button
                      className="send-button"
                      type="submit"
                      aria-label="Send message"
                      disabled={busy || !(drafts[activeId!] || "").trim()}
                    >
                      <Icon name="send" />
                    </button>
                  </div>
                </form>
                <p className="composer-help">
                  Swear words are censored. One reaction per person, from four
                  available emoji.
                </p>
              </footer>
            </>
          )}
          {view === "notifications" && (
            <section className="content-page">
              <div className="page-heading">
                <div>
                  <h1>Notifications</h1>
                  <p className="page-description">
                    Teacher messages appear first, followed by importance.
                  </p>
                </div>
                <button
                  className="outline-button"
                  onClick={() => {
                    void api("/notifications", { method: "PATCH", body: "{}" })
                      .then(() => notifications.refresh())
                      .catch((error) => setError(errorText(error)));
                  }}
                >
                  Mark all read
                </button>
              </div>
              {notifications.error && (
                <p role="alert" className="error-notice">
                  {notifications.error.message}
                </p>
              )}
              {!notifications.data?.length && (
                <div className="empty-state">
                  <Icon name="bell" />
                  <h2>No notifications yet</h2>
                  <p>New messages will appear here.</p>
                </div>
              )}
              <ul className="notification-list">
                {notifications.data?.map((item) => (
                  <li key={item.id}>
                    <button
                      className={!item.read_at ? "unread" : ""}
                      onClick={() => {
                        openChat(item.chat_id);
                        void api("/notifications", {
                          method: "PATCH",
                          body: jsonBody({ id: item.id }),
                        })
                          .then(() => notifications.refresh())
                          .catch((error) => setError(errorText(error)));
                      }}
                    >
                      <span>
                        <strong>{item.sender_name}</strong>
                        {item.is_teacher && (
                          <span className="label-tag">Teacher</span>
                        )}
                        <p>{item.body}</p>
                      </span>
                      <time>
                        {formatDate(item.created_at)}
                        <br />
                        {formatTime(item.created_at)}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {view === "settings" && (
            <SettingsPanel
              key={me.id}
              api={api}
              me={me}
              onSaved={home.refresh}
            />
          )}
          {view === "wiki" && (
            <WikiPanel api={api} me={me} aiAvailable={aiAvailable} />
          )}
          {view === "moderation" && isModerator && (
            <ModerationPanel api={api} me={me} onChanged={refreshAll} />
          )}
        </main>
        {view === "chat" && active && (
          <aside className="details-sidebar" aria-label="Chat details">
            <section className="group-details">
              <Avatar initial={chatName(active)[0]} />
              <h2>{chatName(active)}</h2>
              <p>
                {active.kind === "self"
                  ? "Your private space for notes."
                  : "Be kind and help each other out."}
              </p>
            </section>
            <section className="details-section">{memberPanel}</section>
          </aside>
        )}
      </div>
      {createChat && (
        <CreateChat
          api={api}
          me={me}
          onClose={() => setCreateChat(false)}
          onDone={(id) => {
            setCreateChat(false);
            openChat(id);
            refreshAll();
          }}
        />
      )}
      {addMember && activeId && (
        <CreateChat
          api={api}
          me={me}
          chatId={activeId}
          existingMembers={active?.member_ids}
          onClose={() => setAddMember(false)}
          onDone={() => {
            setAddMember(false);
            refreshAll();
          }}
        />
      )}
      {report && (
        <ReportDialog
          api={api}
          target={report}
          onClose={() => setReport(null)}
          onDone={() => {
            setReport(null);
            setNotice("Report sent to the moderation team.");
          }}
        />
      )}
      {showMembers && (
        <Modal title="Chat details" onClose={() => setShowMembers(false)}>
          {memberPanel}
        </Modal>
      )}
      {showStickers && (
        <Modal title="Stickers & GIFs" onClose={() => setShowStickers(false)}>
          <p className="muted">
            Human-made WICKY artwork, reviewed before sharing.
          </p>
          <div className="sticker-grid">
            {stickers.data?.map((sticker) => (
              <button
                key={sticker.id}
                title={sticker.name}
                disabled={busy}
                onClick={() => void send(undefined, sticker.id)}
              >
                {sticker.url && <img src={sticker.url} alt={sticker.name} />}
                <span>
                  {sticker.name}
                  {sticker.is_official && " · Official"}
                </span>
              </button>
            ))}
          </div>
          {!stickers.data?.length && (
            <p className="field-help">
              {stickers.loading
                ? "Loading stickers…"
                : "No approved stickers yet. Upload your artwork to get started."}
            </p>
          )}
          <button
            className="outline-button"
            onClick={() => {
              setShowStickers(false);
              setUploadSticker(true);
            }}
          >
            <Icon name="plus" />
            Upload sticker or GIF
          </button>
          {Boolean(submissions.data?.length) && (
            <section className="plain-section">
              <h3>Your submissions</h3>
              {submissions.data?.map((sticker) => (
                <p className="submission-status" key={sticker.id}>
                  {sticker.name}
                  <span>
                    {sticker.status}
                    {sticker.reject_reason ? `: ${sticker.reject_reason}` : ""}
                  </span>
                </p>
              ))}
            </section>
          )}
          {(stickers.error || submissions.error) && (
            <p className="error-notice" role="alert">
              {stickers.error?.message || submissions.error?.message}
            </p>
          )}
        </Modal>
      )}
      {uploadSticker && (
        <UploadSticker
          api={api}
          admin={me.role === "admin"}
          onClose={() => setUploadSticker(false)}
          onDone={() => {
            setUploadSticker(false);
            setNotice("Sticker submitted. It must be approved before sharing.");
            stickers.refresh();
            submissions.refresh();
          }}
        />
      )}
    </div>
  );
}
