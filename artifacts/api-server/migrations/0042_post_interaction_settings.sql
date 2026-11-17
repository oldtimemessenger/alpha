ALTER TABLE posts
  ADD COLUMN comments_enabled INTEGER NOT NULL DEFAULT 1 CHECK (comments_enabled IN (0, 1));

ALTER TABLE posts
  ADD COLUMN likes_visible INTEGER NOT NULL DEFAULT 1 CHECK (likes_visible IN (0, 1));
