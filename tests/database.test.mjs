import { PGlite } from "@electric-sql/pglite";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
test("database migrations enforce membership, teacher priority, reactions, and spam rules", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create publication supabase_realtime;`);
    const root = new URL("../supabase/migrations/", import.meta.url);
    await db.exec(
      await readFile(new URL("20261013000000_wicky.sql", root), "utf8"),
    );
    await db.exec(
      await readFile(new URL("20261015000000_chat_features.sql", root), "utf8"),
    );
    assert.equal(
      (await db.query("select count(*)::int as n from chats")).rows[0].n,
      0,
    );
    const ids = Array.from({ length: 5 }, () => randomUUID());
    for (const [i, id] of ids.entries())
      await db.query(
        "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
        [
          id,
          `person${i}@chadwickschool.org`,
          JSON.stringify({ name: `Person ${i}` }),
        ],
      );
    const created = await db.query(
      "select public.create_chat($1,$2,$3) as id",
      [ids[0], [ids[1], ids[2]], "Test chat"],
    );
    const chat = created.rows[0].id;
    await assert.rejects(
      db.query("insert into chat_members(chat_id,user_id) values($1,$2)", [
        chat,
        ids[3],
      ]),
      /chat_full/,
    );
    await db.query("update profiles set role='teacher' where id=$1", [ids[3]]);
    await db.query("insert into chat_members(chat_id,user_id) values($1,$2)", [
      chat,
      ids[3],
    ]);
    assert.equal(
      (
        await db.query(
          "select user_id from chat_members where chat_id=$1 and member_role='owner'",
          [chat],
        )
      ).rows[0].user_id,
      ids[3],
    );
    await db.query("insert into chat_members(chat_id,user_id) values($1,$2)", [
      chat,
      ids[4],
    ]);
    await assert.rejects(
      db.query("select public.remove_chat_member($1,$2,$1)", [ids[3], chat]),
      /chat_full/,
    );
    await assert.rejects(
      db.query("update profiles set role='student' where id=$1", [ids[3]]),
      /chat_full/,
    );
    const message = (
      await db.query(
        "insert into messages(chat_id,user_id,body,importance) values($1,$2,'Hello','important') returning id",
        [chat, ids[3]],
      )
    ).rows[0].id;
    const notification = (
      await db.query(
        "select priority, is_teacher from notifications where message_id=$1",
        [message],
      )
    ).rows[0];
    assert.deepEqual(notification, { priority: 140, is_teacher: true });
    await db.query("select toggle_reaction($1,$2,$3)", [ids[0], message, "👍"]);
    await db.query("select toggle_reaction($1,$2,$3)", [ids[0], message, "✅"]);
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from message_reactions where message_id=$1",
          [message],
        )
      ).rows[0].n,
      1,
    );
    await db.query("select toggle_reaction($1,$2,$3)", [ids[0], message, "✅"]);
    assert.equal(
      (
        await db.query(
          "select count(*)::int as n from message_reactions where message_id=$1",
          [message],
        )
      ).rows[0].n,
      0,
    );
    await db.query(
      "insert into messages(chat_id,user_id,body) values($1,$2,'Repeat')",
      [chat, ids[0]],
    );
    await db.query(
      "insert into messages(chat_id,user_id,body) values($1,$2,'Repeat')",
      [chat, ids[0]],
    );
    await assert.rejects(
      db.query(
        "insert into messages(chat_id,user_id,body) values($1,$2,'Repeat')",
        [chat, ids[0]],
      ),
      /spam/,
    );

    await assert.rejects(
      db.query("select set_chat_member_role($1,$2,$3,$4)", [
        ids[3],
        chat,
        ids[0],
        "owner",
      ]),
      /teacher_owner/,
    );
    await db.query("update profiles set role='teacher' where id=$1", [ids[4]]);
    await db.query("select set_chat_member_role($1,$2,$3,$4)", [
      ids[3],
      chat,
      ids[4],
      "owner",
    ]);
    assert.equal(
      (
        await db.query(
          "select user_id from chat_members where chat_id=$1 and member_role='owner'",
          [chat],
        )
      ).rows[0].user_id,
      ids[4],
    );
    await db.query("update profiles set role='admin' where id=$1", [ids[0]]);
    await assert.rejects(
      db.query("select set_profile_role($1,$1,$2)", [ids[0], "student"]),
      /last_admin/,
    );
    await db.query("select set_profile_role($1,$2,$3)", [
      ids[0],
      ids[4],
      "student",
    ]);
    assert.equal(
      (
        await db.query(
          "select user_id from chat_members where chat_id=$1 and member_role='owner'",
          [chat],
        )
      ).rows[0].user_id,
      ids[3],
    );
    const outsider = randomUUID();
    await db.query(
      "insert into auth.users(id,email) values($1,'outsider@chadwickschool.org')",
      [outsider],
    );
    await db.exec(
      "grant usage on schema public, auth to authenticated; grant select on all tables in schema public to authenticated;",
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      outsider,
    ]);
    await db.exec("set role authenticated;");
    assert.equal(
      (await db.query("select count(*)::int as n from messages")).rows[0].n,
      0,
    );
    await assert.rejects(
      db.query("select toggle_reaction($1,$2,$3)", [ids[0], message, "👍"]),
      /permission denied/,
    );
    await db.exec("reset role;");
  } finally {
    await db.close();
  }
});
