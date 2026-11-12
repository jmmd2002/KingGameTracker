-- All tables use IF NOT EXISTS so this runs safely on every startup.

CREATE TABLE IF NOT EXISTS players (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT  -- set when a player with game history is removed
);

CREATE TABLE IF NOT EXISTS games (
    id          INTEGER PRIMARY KEY,
    started_at  TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT  -- NULL while the game is in progress
);

CREATE TABLE IF NOT EXISTS game_players (
    game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
    seat      INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
    PRIMARY KEY (game_id, player_id),
    UNIQUE (game_id, seat)
);

-- One row per round played. round_type is a key from app/rounds.py.
-- No uniqueness on (game_id, round_type): Koz will be played once per player.
CREATE TABLE IF NOT EXISTS rounds (
    id         INTEGER PRIMARY KEY,
    game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    round_type TEXT NOT NULL,
    chooser_id INTEGER REFERENCES players(id) ON DELETE RESTRICT,
    played_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Raw count (tricks, hearts, ...) is the source of truth; points is derived
-- from it by app/rounds.py and stored for fast stats queries.
CREATE TABLE IF NOT EXISTS round_scores (
    round_id  INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
    count     INTEGER NOT NULL CHECK (count >= 0),
    points    INTEGER NOT NULL,
    PRIMARY KEY (round_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_rounds_game ON rounds(game_id);
CREATE INDEX IF NOT EXISTS idx_round_scores_player ON round_scores(player_id);
CREATE INDEX IF NOT EXISTS idx_game_players_player ON game_players(player_id);
