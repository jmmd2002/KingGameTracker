import sqlite3
from pathlib import Path

from flask import Flask, current_app, g

SCHEMA = Path(__file__).with_name("schema.sql")


def connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE"])
    return g.db


def close_db(_exc=None) -> None:
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_app(app: Flask) -> None:
    app.teardown_appcontext(close_db)
    conn = connect(app.config["DATABASE"])
    try:
        conn.executescript(SCHEMA.read_text())
    finally:
        conn.close()
