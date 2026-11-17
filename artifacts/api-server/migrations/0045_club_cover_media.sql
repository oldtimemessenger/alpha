ALTER TABLE clubs ADD COLUMN cover_media_id TEXT
  REFERENCES user_media_assets(id) ON DELETE SET NULL;
