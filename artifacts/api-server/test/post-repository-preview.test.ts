import { strict as assert } from "node:assert";
import { test } from "node:test";
import { hydratePosts } from "../src/cloudflare/post-repository";

const postId = "b2f35ca8-dc11-4c3c-bffc-06f65981b51a";
const viewerId = "a9c8bf6d-3a25-4c1e-9bb8-1dc97e2ba20f";

function database(previewRows: unknown[]) {
  const statements: { sql: string; params: unknown[] }[] = [];
  return {
    statements,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          return {
            async all() {
              const isPreview = sql.includes("FROM post_reposts r JOIN users u")
                && sql.includes("rank<=2");
              return { results: isPreview ? previewRows : [] };
            },
          };
        },
      };
    },
  } as any;
}

test("feed hydration returns two recent visible reposters and preserves privacy filters", async () => {
  const db = database([
    {
      post_id: postId,
      id: "reposter-1",
      username: "first",
      display_name: "First",
      created_at: 12,
      data: JSON.stringify({ profile: { avatar: "first.webp" } }),
    },
    {
      post_id: postId,
      id: "reposter-2",
      username: "second",
      display_name: "Second",
      created_at: 11,
      data: JSON.stringify({ profile: { avatar: "second.webp" } }),
    },
  ]);
  const [post] = await hydratePosts(db, viewerId, [{
    id: postId,
    source_id: null,
    remix_source_post_id: null,
    audio_source_post_id: null,
    thread_id: null,
    thread_position: null,
    author_id: "creator",
    text: "A post",
    visibility: "public",
    archived_at: null,
    audio_reuse_allowed: 0,
    destination: "main",
    place: null,
    created_at: 1,
    username: "creator",
    display_name: "Creator",
    joined_at: 1,
    profile_data: null,
    author_is_private: 0,
    like_count: 0,
    comment_count: 0,
    human_like_count: 0,
    human_commenter_count: 0,
    repost_count: 3,
    remix_count: 0,
    view_count: 0,
    save_count: 0,
    liked: 0,
    repost_note: null,
    followed: 0,
    audio_reuse_allowed_effective: 0,
    audio_use_count: 0,
  }]);

  assert.deepEqual(post.repostedByPreview?.map(person => person.id), ["reposter-1", "reposter-2"]);
  assert.deepEqual(post.repostedByPreview?.map(person => person.avatar), ["first.webp", "second.webp"]);
  const query = db.statements.find(({ sql }: { sql: string }) => sql.includes("rank<=2"));
  assert.ok(query);
  assert.match(query.sql, /u\.is_virtual=0/);
  assert.match(query.sql, /u\.id=\(SELECT id FROM viewer\) OR u\.is_private=0 OR EXISTS/);
  assert.match(query.sql, /FROM account_blocks/);
});
