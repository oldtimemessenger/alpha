PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clubs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL,
  privacy TEXT NOT NULL CHECK (privacy IN ('public', 'request_to_join', 'private')),
  rules TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS club_members (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'moderator', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'invited')),
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (club_id, user_id)
);

CREATE INDEX IF NOT EXISTS club_members_user_status_idx
  ON club_members(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS club_members_club_status_idx
  ON club_members(club_id, status, role);

ALTER TABLE posts ADD COLUMN club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN show_in_main_feed INTEGER NOT NULL DEFAULT 0
  CHECK (show_in_main_feed IN (0, 1));
CREATE INDEX IF NOT EXISTS posts_club_feed_idx
  ON posts(club_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS posts_club_main_preview_idx
  ON posts(show_in_main_feed, created_at DESC)
  WHERE club_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS club_discussions (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS club_discussions_feed_idx
  ON club_discussions(club_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS club_discussion_replies (
  id TEXT PRIMARY KEY NOT NULL,
  discussion_id TEXT NOT NULL REFERENCES club_discussions(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES club_discussion_replies(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS club_discussion_replies_thread_idx
  ON club_discussion_replies(discussion_id, parent_id, created_at, id);

CREATE TABLE IF NOT EXISTS club_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  started_by TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'watch')),
  title TEXT NOT NULL DEFAULT '',
  post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS club_rooms_one_active_kind_idx
  ON club_rooms(club_id, kind) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS club_rooms_active_idx
  ON club_rooms(club_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS club_room_members (
  room_id TEXT NOT NULL REFERENCES club_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS club_room_tickets (
  token_hash TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL REFERENCES club_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS club_room_tickets_expiry_idx
  ON club_room_tickets(expires_at);
