def create(client, name):
    return client.post("/api/players", json={"name": name})


def test_create_and_list(client):
    r = create(client, "  Ana   Silva ")
    assert r.status_code == 201
    assert r.json["name"] == "Ana Silva"
    assert [p["name"] for p in client.get("/api/players").json] == ["Ana Silva"]


def test_name_validation(client):
    assert create(client, "").status_code == 400
    assert create(client, "   ").status_code == 400
    assert create(client, "x" * 41).status_code == 400
    assert client.post("/api/players", json={}).status_code == 400


def test_duplicate_name_case_insensitive(client):
    create(client, "Ana")
    r = create(client, "ana")
    assert r.status_code == 409


def test_rename(client):
    pid = create(client, "Ana").json["id"]
    create(client, "Bruno")
    assert client.patch(f"/api/players/{pid}", json={"name": "Anabela"}).json["name"] == "Anabela"
    assert client.patch(f"/api/players/{pid}", json={"name": "BRUNO"}).status_code == 409
    assert client.patch("/api/players/999", json={"name": "X"}).status_code == 404


def test_delete_player_without_history(client):
    pid = create(client, "Ana").json["id"]
    assert client.delete(f"/api/players/{pid}").json == {"result": "deleted"}
    assert client.get("/api/players?archived=1").json == []


def test_remove_player_with_history_archives_and_restores(client, add_game):
    ids = [create(client, n).json["id"] for n in "ABCD"]
    add_game(ids, {"damas": [4, 0, 0, 0]})
    assert client.delete(f"/api/players/{ids[0]}").json == {"result": "archived"}
    assert len(client.get("/api/players").json) == 3
    archived = [p for p in client.get("/api/players?archived=1").json if p["archived"]]
    assert [p["name"] for p in archived] == ["A"]
    assert archived[0]["games"]["played"] == 1  # history kept

    # Name stays reserved while archived.
    assert create(client, "a").status_code == 409
    restored = client.patch(f"/api/players/{ids[0]}", json={"archived": False}).json
    assert restored["archived"] is False


def test_stats(client, add_game):
    a, b, c, d = (create(client, n).json["id"] for n in "ABCD")
    # Game 1: A takes all queens; B,C,D tie on Damas. A wins Vazas outright.
    add_game([a, b, c, d], {"damas": [4, 0, 0, 0], "vazas": [0, 5, 4, 4]})
    # Game 2 (unfinished): counts for rounds but not games.
    add_game([a, b, c, d], {"damas": [0, 4, 0, 0]}, finished=False)

    stats = {p["name"]: p for p in client.get("/api/players").json}
    A, B = stats["A"], stats["B"]

    assert A["rounds"]["damas"] == {"played": 2, "won": 1, "win_rate": 0.5, "avg_points": -200}
    assert A["rounds"]["vazas"]["win_rate"] == 1.0
    assert B["rounds"]["damas"]["win_rate"] == 0.5
    assert A["rounds"]["copas"] == {"played": 0, "won": 0, "win_rate": None, "avg_points": None}
    assert A["rounds_overall"]["played"] == 3 and A["rounds_overall"]["won"] == 2

    # Game 1 totals: A -400, B -250, C -200, D -200 -> C and D tie for the win.
    assert A["games"]["played"] == 1 and A["games"]["won"] == 0
    assert stats["C"]["games"]["won"] == 1 and stats["D"]["games"]["won"] == 1
    assert stats["C"]["games"]["best_total"] == -200


def test_round_types_endpoint(client):
    keys = [r["key"] for r in client.get("/api/round-types").json]
    assert keys == ["vazas", "copas", "homens", "damas", "rei_de_copas", "ultimos_dois"]


def test_history_placement_and_summary(client, add_game):
    a, b, c, d = (create(client, n).json["id"] for n in "ABCD")
    add_game([a, b, c, d], {"damas": [4, 0, 0, 0], "vazas": [0, 5, 4, 4]})  # A -400, B -250, C/D -200
    add_game([a, b, c, d], {"damas": [0, 0, 0, 4]})  # D -400, others 0
    add_game([a, b, c, d], {"copas": [13, 0, 0, 0]}, finished=False)

    detail = client.get(f"/api/players/{a}").json
    assert [(h["total"], h["place"], h["seats"]) for h in detail["history"]] == [(-400, 4, 4), (0, 1, 4)]
    assert detail["games"]["avg_place"] == 2.5

    c_hist = client.get(f"/api/players/{c}").json["history"]
    assert [h["place"] for h in c_hist] == [1, 1]  # tied first, then shared first

    assert client.get("/api/players/999").status_code == 404
    assert client.get("/api/summary").json | {"last_game_at": None} == {
        "players": 4, "games": 2, "games_in_progress": 1, "rounds": 4, "last_game_at": None,
    }
