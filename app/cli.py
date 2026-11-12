"""Developer commands. Run with: flask --app app <command>"""

import random
from datetime import datetime, timedelta, timezone

import click
from flask import Flask
from flask.cli import with_appcontext

from .db import get_db
from .rounds import ROUND_TYPES

DEMO_PLAYERS = [
    "Ana Costa", "Bruno Silva", "Carla Mendes", "Diogo Ferreira", "Inês Rocha", "João Pereira",
    "Marta Lopes", "Rui Santos", "Sofia Almeida", "Tiago Martins", "Beatriz Nunes", "Pedro Carvalho",
]
DEMO_ARCHIVED = "Pedro Carvalho"  # shows how removed players look


@click.command("seed-demo")
@click.option("--games", default=90, show_default=True, help="Number of games to generate.")
@click.option("--seed", default=1, show_default=True, help="Random seed.")
@with_appcontext
def seed_demo(games: int, seed: int) -> None:
    """Fill an EMPTY database with demo players and random finished games.

    Use a separate database so demo data never mixes with real games:
        KING_DB=instance/demo.db flask --app app seed-demo
    """
    db = get_db()
    if db.execute("SELECT COUNT(*) FROM players").fetchone()[0]:
        raise click.ClickException(
            "This database already has players. seed-demo only runs on an empty database; "
            "point KING_DB at a separate file, e.g. KING_DB=instance/demo.db."
        )

    rng = random.Random(seed)
    now = datetime.now(timezone.utc)  # DB timestamps are UTC
    span_days = 180
    ids = []
    for i, name in enumerate(DEMO_PLAYERS):
        joined = (now - timedelta(days=span_days + 10 - i * 6)).strftime("%Y-%m-%d %H:%M:%S")
        ids.append(
            db.execute("INSERT INTO players (name, created_at) VALUES (?, ?)", (name, joined)).lastrowid
        )
    # Higher weight = takes more penalty cards = plays worse. Gives varied win rates.
    # A per-round skill multiplier makes each player stronger at some rounds than others.
    weight = {pid: rng.uniform(0.6, 1.6) for pid in ids}
    round_skill = {(pid, rt.key): rng.uniform(0.7, 1.4) for pid in ids for rt in ROUND_TYPES}
    # Regulars play more often than occasional players.
    frequency = [rng.uniform(0.3, 1.0) for _ in ids]

    def play_game(started: datetime, rounds_to_play, finished: bool, pool=ids) -> None:
        table = []
        while len(table) < 4:
            pid = rng.choices(pool, weights=[frequency[ids.index(i)] for i in pool])[0]
            if pid not in table:
                table.append(pid)
        stamp = started.strftime("%Y-%m-%d %H:%M:%S")
        game_id = db.execute(
            "INSERT INTO games (started_at, finished_at) VALUES (?, ?)",
            (stamp, stamp if finished else None),
        ).lastrowid
        for seat, pid in enumerate(table):
            db.execute(
                "INSERT INTO game_players (game_id, player_id, seat) VALUES (?, ?, ?)",
                (game_id, pid, seat),
            )
        for i, rt in enumerate(rounds_to_play):
            counts = [0, 0, 0, 0]
            w = [weight[p] * round_skill[(p, rt.key)] for p in table]
            for _ in range(rt.units_total):
                counts[rng.choices(range(4), weights=w)[0]] += 1
            rt.validate_counts(counts)
            round_id = db.execute(
                "INSERT INTO rounds (game_id, round_type, chooser_id, played_at) VALUES (?, ?, ?, ?)",
                (game_id, rt.key, table[i % 4], stamp),
            ).lastrowid
            for pid, c in zip(table, counts):
                db.execute(
                    "INSERT INTO round_scores (round_id, player_id, count, points) VALUES (?, ?, ?, ?)",
                    (round_id, pid, c, rt.points(c)),
                )

    for g in range(games):
        days_ago = span_days * (games - g) / games
        started = now - timedelta(days=days_ago, hours=rng.randint(0, 5), minutes=rng.randint(0, 59))
        play_game(started, ROUND_TYPES, finished=True)
    current = [pid for pid, name in zip(ids, DEMO_PLAYERS) if name != DEMO_ARCHIVED]
    play_game(now - timedelta(minutes=40), ROUND_TYPES[:3], finished=False, pool=current)

    db.execute(
        "UPDATE players SET archived_at = datetime('now', '-20 days') WHERE name = ?",
        (DEMO_ARCHIVED,),
    )
    db.commit()
    click.echo(f"Added {len(ids)} players, {games} finished games and 1 game in progress.")


@click.command("reset-db")
@click.option("--yes", is_flag=True, help="Skip the confirmation prompt.")
@with_appcontext
def reset_db(yes: bool) -> None:
    """Delete ALL players, games and rounds from the database (e.g. to clear demo data)."""
    from flask import current_app

    path = current_app.config["DATABASE"]
    if not yes:
        click.confirm(f"Delete every player, game and round in {path}?", abort=True)
    db = get_db()
    db.executescript(
        "DELETE FROM round_scores; DELETE FROM rounds; DELETE FROM game_players;"
        " DELETE FROM games; DELETE FROM players;"
    )
    click.echo("Database cleared.")


def init_app(app: Flask) -> None:
    app.cli.add_command(seed_demo)
    app.cli.add_command(reset_db)
