CREATE TABLE IF NOT EXISTS post_photo_tags (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES user_media_assets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tagged_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  x REAL NOT NULL CHECK (x >= 0 AND x <= 1),
  y REAL NOT NULL CHECK (y >= 0 AND y <= 1),
  created_at INTEGER NOT NULL,
  UNIQUE (post_id, media_id, user_id)
);

CREATE INDEX IF NOT EXISTS post_photo_tags_user_created_idx
  ON post_photo_tags(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_collaboration_invites (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at INTEGER NOT NULL,
  responded_at INTEGER,
  UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS post_collaboration_user_status_idx
  ON post_collaboration_invites(user_id, status, created_at DESC);
