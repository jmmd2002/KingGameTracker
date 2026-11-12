import pytest

from app import create_app
from app.db import connect
from app.rounds import BY_KEY


@pytest.fixture
def app(tmp_path):
    return create_app({"TESTING": True, "DATABASE": str(tmp_path / "test.db")})


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def add_game(app):
    """Insert a finished game. rounds = {round_key: [count per player]}, in `player_ids` order."""

    def _add(player_ids, rounds, finished=True):
        conn = connect(app.config["DATABASE"])
        game_id = conn.execute(
            "INSERT INTO games (finished_at) VALUES (CASE WHEN ? THEN datetime('now') END)",
            (finished,),
        ).lastrowid
        for seat, pid in enumerate(player_ids):
            conn.execute("INSERT INTO game_players VALUES (?, ?, ?)", (game_id, pid, seat))
        for key, counts in rounds.items():
            rt = BY_KEY[key]
            rt.validate_counts(counts)
            rid = conn.execute(
                "INSERT INTO rounds (game_id, round_type) VALUES (?, ?)", (game_id, key)
            ).lastrowid
            for pid, c in zip(player_ids, counts):
                conn.execute(
                    "INSERT INTO round_scores VALUES (?, ?, ?, ?)", (rid, pid, c, rt.points(c))
                )
        conn.commit()
        conn.close()
        return game_id

    return _add
