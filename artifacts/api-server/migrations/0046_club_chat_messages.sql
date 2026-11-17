PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS club_chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS club_chat_messages_feed_idx
  ON club_chat_messages(club_id, created_at DESC, id DESC);
