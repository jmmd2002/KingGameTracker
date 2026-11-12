"""Player statistics, computed from saved rounds and finished games.

Definitions:
- A player wins a round if they have the best (highest) points in that round.
  Ties count as a win for every tied player.
- A player wins a game if they have the best total in a finished game. Ties count
  as a win for every tied player.
"""

import sqlite3

from .rounds import ROUND_TYPES


def _rate(won: int, played: int) -> float | None:
    return won / played if played else None


def _empty_bucket() -> dict:
    return {"played": 0, "won": 0, "win_rate": None, "avg_points": None}


ROUND_STATS_SQL = """
SELECT rs.player_id, r.round_type,
       COUNT(*)                     AS played,
       SUM(rs.points = best.points) AS won,
       SUM(rs.points)               AS points
FROM round_scores rs
JOIN rounds r ON r.id = rs.round_id
JOIN (SELECT round_id, MAX(points) AS points FROM round_scores GROUP BY round_id) best
  ON best.round_id = rs.round_id
GROUP BY rs.player_id, r.round_type
"""

# Per finished game: each player's total and placement (ties share the better place).
GAME_TOTALS_CTE = """
WITH totals AS (
    SELECT r.game_id, rs.player_id, SUM(rs.points) AS total
    FROM round_scores rs
    JOIN rounds r ON r.id = rs.round_id
    JOIN games g  ON g.id = r.game_id
    WHERE g.finished_at IS NOT NULL
    GROUP BY r.game_id, rs.player_id
),
placed AS (
    SELECT game_id, player_id, total,
           RANK() OVER (PARTITION BY game_id ORDER BY total DESC) AS place,
           COUNT(*) OVER (PARTITION BY game_id) AS seats
    FROM totals
)
"""

GAME_STATS_SQL = GAME_TOTALS_CTE + """
SELECT player_id,
       COUNT(*)          AS played,
       SUM(place = 1)    AS won,
       AVG(total)        AS avg_points,
       MAX(total)        AS best_total,
       AVG(place)        AS avg_place
FROM placed
GROUP BY player_id
"""

HISTORY_SQL = GAME_TOTALS_CTE + """
SELECT p.game_id, g.started_at AS date, p.total, p.place, p.seats
FROM placed p JOIN games g ON g.id = p.game_id
WHERE p.player_id = ?
ORDER BY g.started_at DESC, p.game_id DESC
LIMIT ?
"""


def player_stats(
    db: sqlite3.Connection, include_archived: bool = False, player_id: int | None = None
) -> list[dict]:
    where, params = [], []
    if not include_archived:
        where.append("p.archived_at IS NULL")
    if player_id is not None:
        where.append("p.id = ?")
        params.append(player_id)
    sql = """
        SELECT p.id, p.name, p.created_at, p.archived_at,
               (SELECT MAX(g.started_at) FROM game_players gp
                JOIN games g ON g.id = gp.game_id
                WHERE gp.player_id = p.id) AS last_played_at
        FROM players p
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY p.name COLLATE NOCASE"

    players: dict[int, dict] = {}
    for row in db.execute(sql, params):
        players[row["id"]] = {
            "id": row["id"],
            "name": row["name"],
            "created_at": row["created_at"],
            "archived": row["archived_at"] is not None,
            "last_played_at": row["last_played_at"],
            "games": {**_empty_bucket(), "best_total": None, "avg_place": None},
            "rounds": {rt.key: _empty_bucket() for rt in ROUND_TYPES},
            "rounds_overall": _empty_bucket(),
        }
    if not players:
        return []

    for row in db.execute(ROUND_STATS_SQL):
        p = players.get(row["player_id"])
        if p is None or row["round_type"] not in p["rounds"]:
            continue
        bucket = p["rounds"][row["round_type"]]
        bucket.update(
            played=row["played"],
            won=row["won"],
            win_rate=_rate(row["won"], row["played"]),
            avg_points=row["points"] / row["played"],
        )
        overall = p["rounds_overall"]
        overall["played"] += row["played"]
        overall["won"] += row["won"]
        overall["_points"] = overall.get("_points", 0) + row["points"]

    for p in players.values():
        overall = p["rounds_overall"]
        total_points = overall.pop("_points", None)
        overall["win_rate"] = _rate(overall["won"], overall["played"])
        if overall["played"]:
            overall["avg_points"] = total_points / overall["played"]

    for row in db.execute(GAME_STATS_SQL):
        p = players.get(row["player_id"])
        if p is None:
            continue
        p["games"].update(
            played=row["played"],
            won=row["won"],
            win_rate=_rate(row["won"], row["played"]),
            avg_points=row["avg_points"],
            best_total=row["best_total"],
            avg_place=row["avg_place"],
        )

    return list(players.values())


def player_history(db: sqlite3.Connection, player_id: int, limit: int = 20) -> list[dict]:
    """The player's most recent finished games, oldest first."""
    rows = db.execute(HISTORY_SQL, (player_id, limit)).fetchall()
    return [dict(r) for r in reversed(rows)]


def summary(db: sqlite3.Connection) -> dict:
    row = db.execute(
        """SELECT
             (SELECT COUNT(*) FROM players WHERE archived_at IS NULL) AS players,
             (SELECT COUNT(*) FROM games WHERE finished_at IS NOT NULL) AS games,
             (SELECT COUNT(*) FROM games WHERE finished_at IS NULL) AS games_in_progress,
             (SELECT COUNT(*) FROM rounds) AS rounds,
             (SELECT MAX(started_at) FROM games) AS last_game_at"""
    ).fetchone()
    return dict(row)
