import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { clubRequest } from "../src/cloudflare/clubs";
import { canReadMedia } from "../src/cloudflare/media";
import type { Database, Statement } from "../src/cloudflare/runtime";

function fixture(t: { after: (fn: () => void) => void }) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  t.after(() => sqlite.close());

  function prepare(sql: string): Statement {
    let values: unknown[] = [];
    return {
      bind(...input: unknown[]) { values = input; return this; },
      async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...values) as T[] }; },
      async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
      async run<T>() {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }

  const db: Database = {
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = await Promise.all(statements.map((statement) => statement.run()));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };

  function user(username: string) {
    const id = randomUUID();
    sqlite.prepare(`INSERT INTO users(id,email,username,display_name,password_salt,password_hash,created_at,is_private)
      VALUES(?,?,?,?,?,?,?,0)`).run(
      id, `${username}@example.test`, username, username, "test-salt", "test-hash", Date.now(),
    );
    return id;
  }

  async function request(userId: string, path: string, method = "GET", data?: unknown) {
    const url = new URL(`https://oldtime.test/api${path}`);
    return clubRequest(new Request(url, {
      method,
      ...(data === undefined ? {} : {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    }), db, userId, url.pathname.slice("/api".length));
  }

  return { sqlite, db, user, request };
}

test("request-to-join Clubs stay discoverable but keep chat members-only", async (t) => {
  const f = fixture(t);
  const owner = f.user("club_owner");
  const requester = f.user("club_requester");
  const outsider = f.user("club_outsider");

  const created = await f.request(owner, "/clubs", "POST", {
    name: "Creative Circle",
    topic: "Art",
    description: "A shared space for making things.",
    privacy: "request_to_join",
  });
  assert.equal(created.status, 201);
  const clubId = (await created.json() as any).club.id as string;
  assert.match(clubId, /^[a-f0-9-]{36}$/i);

  const discoverable = await f.request(requester, "/clubs");
  assert.equal((await discoverable.json() as any).clubs[0].name, "Creative Circle");
  await assert.rejects(f.request(outsider, `/clubs/${clubId}/messages`), /Join this Club/);

  const requested = await f.request(requester, `/clubs/${clubId}/join`, "POST");
  assert.equal((await requested.json() as any).status, "pending");
  const requests = await f.request(owner, `/clubs/${clubId}/requests`);
  assert.equal((await requests.json() as any).requests[0].id, requester);

  const approved = await f.request(owner, `/clubs/${clubId}/requests/${requester}`, "POST", {
    decision: "approve",
  });
  assert.equal((await approved.json() as any).status, "active");

  const messageId = randomUUID();
  const sent = await f.request(requester, `/clubs/${clubId}/messages`, "POST", {
    id: messageId,
    body: "Glad to be here.",
  });
  assert.equal(sent.status, 201);
  assert.equal((await sent.json() as any).message.body, "Glad to be here.");
  const history = await f.request(owner, `/clubs/${clubId}/messages`);
  assert.equal((await history.json() as any).messages[0].id, messageId);
  await assert.rejects(f.request(outsider, `/clubs/${clubId}/messages`), /Join this Club/);
});

test("public Clubs let members join and owners cannot accidentally leave", async (t) => {
  const f = fixture(t);
  const owner = f.user("public_club_owner");
  const member = f.user("public_club_member");
  const created = await f.request(owner, "/clubs", "POST", {
    name: "Garden Friends",
    topic: "Gardening",
    privacy: "public",
  });
  const clubId = (await created.json() as any).club.id as string;

  const joined = await f.request(member, `/clubs/${clubId}/join`, "POST");
  assert.equal((await joined.json() as any).status, "active");
  const left = await f.request(member, `/clubs/${clubId}/leave`, "POST");
  assert.equal((await left.json() as any).status, "left");
  await assert.rejects(f.request(owner, `/clubs/${clubId}/leave`, "POST"), /owner cannot leave/);
});

test("Club creation saves approved cover presets and rejects unknown or unowned covers", async (t) => {
  const f = fixture(t);
  const owner = f.user("cover_club_owner");
  const created = await f.request(owner, "/clubs", "POST", {
    name: "Love and Letters",
    topic: "Love",
    coverPresetId: "love-letters",
  });
  assert.equal(created.status, 201);
  const club = (await created.json() as any).club;
  assert.equal(club.coverPresetId, "love-letters");
  assert.equal(club.coverMediaReference, null);

  await assert.rejects(f.request(owner, "/clubs", "POST", {
    name: "Unknown Cover",
    topic: "Art",
    coverPresetId: "unapproved-cover",
  }), /coverPresetId/);

  await assert.rejects(f.request(owner, "/clubs", "POST", {
    name: "Uploaded Cover",
    topic: "Art",
    coverMediaId: randomUUID(),
  }), /confirmed image from your account/);
});

test("Club creation accepts blank details and uses public defaults", async (t) => {
  const f = fixture(t);
  const owner = f.user("simple_club_owner");
  const created = await f.request(owner, "/clubs", "POST", {
    name: "",
    topic: "",
  });
  assert.equal(created.status, 201);
  const club = (await created.json() as any).club;
  assert.equal(club.name, "New Club");
  assert.equal(club.topic, "General");
  assert.equal(club.privacy, "public");
});

test("Club cover changes and group deletion are restricted to the creator", async (t) => {
  const f = fixture(t);
  const owner = f.user("manage_club_owner");
  const member = f.user("manage_club_member");
  const created = await f.request(owner, "/clubs", "POST", {
    name: "Creators Circle",
    topic: "Design",
  });
  const clubId = (await created.json() as any).club.id as string;
  await f.request(member, `/clubs/${clubId}/join`, "POST");
  await f.request(member, `/clubs/${clubId}/messages`, "POST", {
    id: randomUUID(), body: "Hello, group.",
  });

  await assert.rejects(f.request(member, `/clubs/${clubId}/cover`, "PATCH", {
    coverPresetId: "love-letters",
  }), /Only the Club creator can change its cover/);
  const changedCover = await f.request(owner, `/clubs/${clubId}/cover`, "PATCH", {
    coverPresetId: "love-letters",
  });
  assert.equal((await changedCover.json() as any).club.coverPresetId, "love-letters");

  await assert.rejects(f.request(member, `/clubs/${clubId}`, "DELETE", {
    confirmation: "Creators Circle",
  }), /Only the Club creator can delete this group chat/);
  await assert.rejects(f.request(owner, `/clubs/${clubId}`, "DELETE", {
    confirmation: "creators circle",
  }), /Type the Club name exactly to delete its shared chat/);
  assert.equal(Number(f.sqlite.prepare("SELECT COUNT(*) AS n FROM club_chat_messages").get()?.n), 1);

  const deleted = await f.request(owner, `/clubs/${clubId}`, "DELETE", {
    confirmation: "Creators Circle",
  });
  assert.equal((await deleted.json() as any).deleted, true);
  assert.equal(Number(f.sqlite.prepare("SELECT COUNT(*) AS n FROM clubs").get()?.n), 0);
  assert.equal(Number(f.sqlite.prepare("SELECT COUNT(*) AS n FROM club_members").get()?.n), 0);
  assert.equal(Number(f.sqlite.prepare("SELECT COUNT(*) AS n FROM club_chat_messages").get()?.n), 0);
});

test("Club chat cursors return only newer messages without missing same-millisecond sends", async (t) => {
  const f = fixture(t);
  const owner = f.user("cursor_club_owner");
  const created = await f.request(owner, "/clubs", "POST", {
    name: "Quick Chat",
    topic: "General",
  });
  const clubId = (await created.json() as any).club.id as string;
  await f.request(owner, `/clubs/${clubId}/messages`, "POST", {
    id: randomUUID(), body: "First.",
  });
  const firstPage = await f.request(owner, `/clubs/${clubId}/messages`);
  const cursor = (await firstPage.json() as any).cursor as string;
  await f.request(owner, `/clubs/${clubId}/messages`, "POST", {
    id: randomUUID(), body: "Second.",
  });
  const nextPage = await f.request(owner, `/clubs/${clubId}/messages?after=${encodeURIComponent(cursor)}`);
  const messages = (await nextPage.json() as any).messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body, "Second.");
  assert.equal(messages[0].createdAt > Number(cursor.split(":")[0]), true);
});

test("uploaded covers are saved on a Club and readable by its discoverable audience", async (t) => {
  const f = fixture(t);
  const owner = f.user("uploaded_cover_owner");
  const viewer = f.user("uploaded_cover_viewer");
  const mediaId = randomUUID();
  f.sqlite.prepare(`INSERT INTO user_media_assets(
    id,user_id,object_key,content_type,size,sha256,storage_scope,media_role,ready,created_at
  ) VALUES(?,?,?,?,?,?,?,?,1,?)`).run(
    mediaId, owner, `media/${mediaId}`, "image/jpeg", 128, "a".repeat(64), "public", "media", Date.now(),
  );
  const created = await f.request(owner, "/clubs", "POST", {
    name: "Photo Club",
    topic: "Photography",
    privacy: "request_to_join",
    coverMediaId: mediaId,
  });
  assert.equal(created.status, 201);
  const club = (await created.json() as any).club;
  assert.equal(club.coverMediaReference, `oldtime-media:${mediaId}`);
  assert.equal(club.coverPresetId, null);
  const asset = {
    id: mediaId, user_id: owner, object_key: `media/${mediaId}`, content_type: "image/jpeg",
    size: 128, sha256: "a".repeat(64), storage_scope: "public", media_role: "media", ready: 1,
  };
  assert.equal(await canReadMedia(f.db, viewer, asset as any), true);
});
