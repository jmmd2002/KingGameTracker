import sqlite3

from flask import Blueprint, jsonify, request

from .db import get_db
from .rounds import ROUND_TYPES
from .stats import player_history, player_stats, summary

bp = Blueprint("players", __name__, url_prefix="/api")

MAX_NAME_LENGTH = 40


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


@bp.errorhandler(ApiError)
def handle_api_error(err: ApiError):
    return jsonify(error=err.message), err.status


def _clean_name(value) -> str:
    if not isinstance(value, str):
        raise ApiError("Name is required.")
    name = " ".join(value.split())
    if not name:
        raise ApiError("Name is required.")
    if len(name) > MAX_NAME_LENGTH:
        raise ApiError(f"Name must be at most {MAX_NAME_LENGTH} characters.")
    return name


def _name_taken_error(db: sqlite3.Connection, name: str) -> ApiError:
    row = db.execute("SELECT archived_at FROM players WHERE name = ?", (name,)).fetchone()
    if row is not None and row["archived_at"] is not None:
        return ApiError(f'A removed player is already called "{name}". Restore them instead.', 409)
    return ApiError(f'A player called "{name}" already exists.', 409)


def _get_player_or_404(db: sqlite3.Connection, player_id: int) -> dict:
    found = player_stats(db, include_archived=True, player_id=player_id)
    if not found:
        raise ApiError("Player not found.", 404)
    return found[0]


def _has_history(db: sqlite3.Connection, player_id: int) -> bool:
    return (
        db.execute(
            """SELECT 1 FROM game_players WHERE player_id = ?
               UNION ALL SELECT 1 FROM round_scores WHERE player_id = ?
               UNION ALL SELECT 1 FROM rounds WHERE chooser_id = ?
               LIMIT 1""",
            (player_id, player_id, player_id),
        ).fetchone()
        is not None
    )


@bp.get("/round-types")
def list_round_types():
    return jsonify([rt.to_dict() for rt in ROUND_TYPES])


@bp.get("/players")
def list_players():
    include_archived = request.args.get("archived") in ("1", "true")
    return jsonify(player_stats(get_db(), include_archived=include_archived))


@bp.get("/summary")
def get_summary():
    return jsonify(summary(get_db()))


@bp.get("/players/<int:player_id>")
def get_player(player_id: int):
    db = get_db()
    player = _get_player_or_404(db, player_id)
    player["history"] = player_history(db, player_id)
    return jsonify(player)


@bp.post("/players")
def create_player():
    data = request.get_json(silent=True) or {}
    name = _clean_name(data.get("name"))
    db = get_db()
    try:
        cur = db.execute("INSERT INTO players (name) VALUES (?)", (name,))
        db.commit()
    except sqlite3.IntegrityError:
        raise _name_taken_error(db, name)
    return jsonify(_get_player_or_404(db, cur.lastrowid)), 201


@bp.patch("/players/<int:player_id>")
def update_player(player_id: int):
    db = get_db()
    _get_player_or_404(db, player_id)
    data = request.get_json(silent=True) or {}
    if "name" not in data and "archived" not in data:
        raise ApiError("Nothing to update.")

    if "name" in data:
        name = _clean_name(data["name"])
        try:
            db.execute("UPDATE players SET name = ? WHERE id = ?", (name, player_id))
        except sqlite3.IntegrityError:
            db.rollback()
            raise _name_taken_error(db, name)

    if "archived" in data:
        if not isinstance(data["archived"], bool):
            raise ApiError("archived must be true or false.")
        db.execute(
            "UPDATE players SET archived_at = CASE WHEN ? THEN datetime('now') END WHERE id = ?",
            (data["archived"], player_id),
        )

    db.commit()
    return jsonify(_get_player_or_404(db, player_id))


@bp.delete("/players/<int:player_id>")
def delete_player(player_id: int):
    """Delete a player with no history; archive (hide, keep stats) one that has played."""
    db = get_db()
    _get_player_or_404(db, player_id)
    if _has_history(db, player_id):
        db.execute(
            "UPDATE players SET archived_at = datetime('now') WHERE id = ?", (player_id,)
        )
        result = "archived"
    else:
        db.execute("DELETE FROM players WHERE id = ?", (player_id,))
        result = "deleted"
    db.commit()
    return jsonify(result=result)
