CREATE TABLE IF NOT EXISTS user_audio_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL CHECK (
    length(date) = 10 AND
    date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  seconds_used INTEGER NOT NULL DEFAULT 0 CHECK (seconds_used BETWEEN 0 AND 1200),
  PRIMARY KEY (user_id, date)
);

ALTER TABLE club_room_members
  ADD COLUMN last_heartbeat_at INTEGER NOT NULL DEFAULT 0;
