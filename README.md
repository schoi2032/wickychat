# WICKY Chat

**[Open the WICKY Chat website](https://wickychat-ci.blondpetal2.chatgpt.site)** · Private site; sign in with your authorized ChatGPT account.

The GitHub repository contains the source code. The link above opens the actual app. The hosted edition and deployment configuration are in `hosted/`; the root application can also run locally or use Supabase.

A blue-and-white school chat app built by Output Club with Next.js, React, and Supabase. The app starts with **no chats or sample messages**. Conversations are created only when you choose to create one.

## Run on localhost

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000. Without Supabase configuration, this starts a local workspace:

- Create your own local profile with a school email and a password of at least 10 characters. Do not reuse a school password.
- The first local account is the administrator. Later accounts are students. Administrators can assign verified teacher or moderator roles in **Moderation → Account roles**.
- Create a chat from **New chat**, or select **Notes to myself**. Other people appear in search after creating an account. Use separate browser profiles to try conversations between local accounts.
- Accounts, password hashes, sessions, chats, messages, stickers, reports, and settings are saved in `.local-data/`, which Git ignores. Restarting the server preserves them.
- Local mode only accepts requests on loopback hosts. Its accounts are for testing on this computer; school email ownership is not verified. Use the Supabase setup below for a shared school deployment.

To run a production build locally:

```sh
npm run build
npm run start:local
```

## Features

- Create chats, private notes, rename chats, add members, and leave chats.
- Messages update automatically, with search, earlier-message loading, unread counts, and a home screen. Chats remain in the sidebar, including on phones.
- Three importance tags: **IMPORTANT**, **SLIGHTLY IMPORTANT**, and **UNIMPORTANT**.
- Teacher notifications take priority over student notifications, followed by message importance.
- A maximum of three members unless a teacher is present. A teacher is always the owner when present. Removing or demoting the last teacher cannot leave an oversized chat behind.
- Swear word censorship and server-side blocking of a third consecutive identical message, including simultaneous requests.
- Explicit AI-assisted message labels. Remote AI messages are labeled too.
- Four reaction choices and one reaction per person per message. Clicking the same reaction removes it; choosing another replaces it.
- Report messages or users. Moderators can review, resolve, dismiss, or hide reported messages.
- Upload custom WICKY stickers and GIFs, track submissions, and share approved artwork. Human-made artwork only. In local mode, every submission needs human moderator approval; it is never described as AI-checked.
- Saved display name, light/dark theme, accent color, font, text size, compact spacing, and Enter-to-send preferences.
- School wiki pages that teachers and moderators can edit.

**AI status:** WICKYpedia's remote AI-answer integration and automated text/image moderation exist in the Supabase backend, but require separate API credential configuration. They are not active in local mode. The interface states when AI is unavailable; it does not generate fake replies or claim that manual moderation is AI moderation.

## Shared school deployment

Create a Supabase project and apply **all** SQL migrations in `supabase/migrations/` in filename order. Configure Google OAuth with the `chadwickschool.org` school domain, and add the app's `/auth/callback` URL to the allowed redirects.

Copy `.env.example` to `.env.local` and configure the Supabase project URL, public anon key, and server-only service role key. Never commit real credentials. With these configured, the app uses Google school sign-in, shared database storage, Supabase realtime updates with polling as a fallback, and Supabase storage for images and stickers.

The first shared administrator must be assigned by a trusted database operator:

```sql
update public.profiles set role = 'admin' where email = 'your-school-email@chadwickschool.org';
```

After that, administrators can manage roles in the app. Creating a local account never grants privileges in the shared school database. The local file service is unavailable when Supabase mode is active.

The root Next.js app needs Supabase configuration for shared hosting. The `hosted/` edition uses the Sites sign-in gateway, D1, and R2 instead, and its access policy currently allows only the owner. Local file storage is intended for a single local server process, not serverless or multi-server hosting.

## Verification

```sh
npm run build
npm test
```

The tests start a separate server on port 3101 with an isolated temporary data directory and an in-memory PostgreSQL database. They verify permissions, empty initial chat lists, persistent messages, censorship, concurrent spam blocking, membership limits, teacher ownership, teacher-priority notifications, reactions, reports, sticker approval, settings, wiki permissions, search, and session handling. Test accounts and conversations never enter your own workspace.
