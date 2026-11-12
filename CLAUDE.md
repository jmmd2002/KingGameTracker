# KingGameTracker

Web app for tracking player scores in games of King and saving results so players can view statistics over time.

## Goals

- Record a game: players, round-by-round scores, final totals, winner.
- Persist every finished game (no data loss on refresh or close).
- Statistics per player: games played, wins, win rate, average/best/worst score, score history.
- Usable on a phone at the table: large tap targets, quick score entry, works at narrow widths.

## Game rules (King, based on Turkish King / Rıfkı)

- 4 players, 52-card deck, 13 tricks per hand.
- Round names are in Portuguese; use these names in the UI and code.
- A full game is 10 rounds: each of the 6 penalty rounds below played once, plus one Koz round per player (4).
- For now only the 6 penalty rounds are implemented (Koz is not implemented yet).

| Round          | Rule                        | Points per unit | Round total |
|----------------|-----------------------------|-----------------|-------------|
| Vazas          | Don't take tricks           | −50 per trick   | −650        |
| Copas          | Don't take hearts           | −30 per heart   | −390        |
| Homens         | Don't take kings or jacks   | −60 per card    | −480        |
| Damas          | Don't take queens           | −100 per queen  | −400        |
| Rei de copas   | Don't take the king of hearts | −320          | −320        |
| Últimos dois   | Don't take the last 2 tricks | −180 per trick | −360        |

Validation: each round's counts must sum to the full total for that round
(13 tricks, 13 hearts, 8 kings/jacks, 4 queens, 1 king of hearts, 2 last tricks).
The 6 penalty rounds total −2600 across all players.

### Koz (not yet implemented)

Trump rounds (+50 per trick, +650 per round, one per player = +2600) will be added later, once the
auction rules for choosing who picks trumps are confirmed. Do not implement Koz until the
user specifies those rules. Keep the round model extensible so Koz can be added without
reworking existing saved games.

## Domain notes

- Score entry is by **counts** (e.g. "player took 3 hearts"); the app computes points. Do not ask users to type points.
- Scoring rules live in one place (a single scoring module), not spread across UI components.
- Validate each round against the totals above before saving.
- Keep raw per-round counts, not only totals, so stats can be recomputed if the rules or stats change.

## Statistics definitions

- **Round win:** the player has the best (highest) points in that round. Ties count as a win for every tied player.
- **Game win:** best total in a *finished* game. Ties count as a win for every tied player.
- Unfinished games count toward round stats, not game stats.
- Removing a player with any history archives them (hidden, stats kept, restorable); a player with no history is deleted.

## Tech stack

- Backend: Python 3 + Flask, SQLite (stdlib `sqlite3`, no ORM). Node is not installed on the dev machine.
- Frontend: plain HTML/CSS/JS in `app/static/`, no build step. Served by Flask.
- DB file: `instance/king.db` by default; override with the `KING_DB` env var.

## Layout

- `app/rounds.py`: round types and scoring (single source of truth for rules)
- `app/schema.sql`: database schema, applied on startup
- `app/stats.py`: player statistics queries
- `app/players.py`: `/api/players` and `/api/round-types` endpoints
- `app/cli.py`: dev commands (`seed-demo`)
- `tests/`: pytest suite

## Commands

- Install: `python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`
- Dev server: `.venv/bin/flask --app app run --debug` (add `--host 0.0.0.0` to open from a phone on the same network)
- Tests: `.venv/bin/pytest`
- Demo data (separate DB, refuses non-empty DBs): `KING_DB=instance/demo.db .venv/bin/flask --app app seed-demo`, then run the server with the same `KING_DB`.

## Conventions

- Never commit secrets; use `.env` locally and keep `.env.example` up to date.
- Local database files (`*.db`, `*.sqlite`) are git-ignored.
- Add tests for scoring and statistics logic, since those are the parts most likely to break silently.
