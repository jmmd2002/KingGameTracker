import pytest

from app.rounds import BY_KEY, ROUND_TYPES


def test_six_rounds_total_minus_2600():
    assert [rt.name for rt in ROUND_TYPES] == [
        "Vazas", "Copas", "Homens", "Damas", "Rei de copas", "Últimos dois",
    ]
    assert sum(rt.round_total for rt in ROUND_TYPES) == -2600


@pytest.mark.parametrize(
    "key,count,points",
    [("vazas", 3, -150), ("copas", 13, -390), ("homens", 2, -120),
     ("damas", 1, -100), ("rei_de_copas", 1, -320), ("ultimos_dois", 2, -360)],
)
def test_points(key, count, points):
    assert BY_KEY[key].points(count) == points


def test_count_out_of_range():
    with pytest.raises(ValueError):
        BY_KEY["damas"].points(5)


def test_validate_counts_must_sum_to_total():
    BY_KEY["damas"].validate_counts([1, 1, 2, 0])
    with pytest.raises(ValueError):
        BY_KEY["damas"].validate_counts([1, 1, 1, 0])
