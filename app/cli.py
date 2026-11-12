"""Developer commands. Run with: flask --app app <command>"""

import random
from datetime import datetime, timedelta

import click
from flask import Flask
from flask.cli import with_appcontext

from .db import get_db
from .rounds import ROUND_TYPES

DEMO_PLAYERS = ["Ana", "Bruno", "Carla", "Diogo", "Inês", "João", "Marta", "Rui"]


@click.command("seed-demo")
@click.option("--games", default=40, show_default=True, help="Number of games to generate.")
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
    ids = [db.execute("INSERT INTO players (name) VALUES (?)", (n,)).lastrowid for n in DEMO_PLAYERS]
    # Higher weight = takes more penalty cards = plays worse. Gives varied win rates.
    weight = {pid: rng.uniform(0.6, 1.6) for pid in ids}
    now = datetime.now()

    for g in range(games):
        table = rng.sample(ids, 4)
        start = (now - timedelta(days=games - g, hours=rng.randint(0, 6))).strftime("%Y-%m-%d %H:%M:%S")
        game_id = db.execute(
            "INSERT INTO games (started_at, finished_at) VALUES (?, ?)", (start, start)
        ).lastrowid
        for seat, pid in enumerate(table):
            db.execute(
                "INSERT INTO game_players (game_id, player_id, seat) VALUES (?, ?, ?)",
                (game_id, pid, seat),
            )
        for i, rt in enumerate(ROUND_TYPES):
            counts = [0, 0, 0, 0]
            for _ in range(rt.units_total):
                counts[rng.choices(range(4), weights=[weight[p] for p in table])[0]] += 1
            rt.validate_counts(counts)
            round_id = db.execute(
                "INSERT INTO rounds (game_id, round_type, chooser_id, played_at) VALUES (?, ?, ?, ?)",
                (game_id, rt.key, table[i % 4], start),
            ).lastrowid
            for pid, c in zip(table, counts):
                db.execute(
                    "INSERT INTO round_scores (round_id, player_id, count, points) VALUES (?, ?, ?, ?)",
                    (round_id, pid, c, rt.points(c)),
                )
    db.commit()
    click.echo(f"Added {len(ids)} players and {games} games.")


def init_app(app: Flask) -> None:
    app.cli.add_command(seed_demo)
