import os
from pathlib import Path

from flask import Flask


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True, static_url_path="")
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    app.config.from_mapping(
        DATABASE=os.environ.get("KING_DB", str(Path(app.instance_path) / "king.db")),
    )
    app.json.sort_keys = False
    if test_config:
        app.config.update(test_config)

    from . import cli, db, players

    db.init_app(app)
    cli.init_app(app)
    app.register_blueprint(players.bp)

    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    return app
