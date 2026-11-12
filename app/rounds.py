"""Round types and scoring. The single source of truth for game rules."""

from dataclasses import dataclass


@dataclass(frozen=True)
class RoundType:
    key: str
    name: str
    rule: str
    unit: str
    points_per_unit: int
    units_total: int  # how many units exist in one round (e.g. 13 hearts)

    @property
    def round_total(self) -> int:
        return self.points_per_unit * self.units_total

    def points(self, count: int) -> int:
        if not 0 <= count <= self.units_total:
            raise ValueError(f"{self.name}: count must be between 0 and {self.units_total}")
        return count * self.points_per_unit

    def validate_counts(self, counts: list[int]) -> None:
        """Raise ValueError unless the counts for all players add up to the round's units."""
        for c in counts:
            self.points(c)
        if sum(counts) != self.units_total:
            raise ValueError(
                f"{self.name}: counts add up to {sum(counts)}, expected {self.units_total}"
            )

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "name": self.name,
            "rule": self.rule,
            "unit": self.unit,
            "points_per_unit": self.points_per_unit,
            "units_total": self.units_total,
            "round_total": self.round_total,
        }


# Koz (trump rounds, one per player) is intentionally not here yet.
ROUND_TYPES: tuple[RoundType, ...] = (
    RoundType("vazas", "Vazas", "Don't take tricks", "trick", -50, 13),
    RoundType("copas", "Copas", "Don't take hearts", "heart", -30, 13),
    RoundType("homens", "Homens", "Don't take kings or jacks", "king/jack", -60, 8),
    RoundType("damas", "Damas", "Don't take queens", "queen", -100, 4),
    RoundType("rei_de_copas", "Rei de copas", "Don't take the king of hearts", "card", -320, 1),
    RoundType("ultimos_dois", "Últimos dois", "Don't take the last 2 tricks", "trick", -180, 2),
)

BY_KEY: dict[str, RoundType] = {rt.key: rt for rt in ROUND_TYPES}
