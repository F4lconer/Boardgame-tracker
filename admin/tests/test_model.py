from pathlib import Path

import pytest

from shelf_admin.model import build, load_yaml, split_expansions, validate

SAMPLE = Path(__file__).resolve().parents[1] / "data" / "collection.yaml"


@pytest.fixture
def data():
    return load_yaml(SAMPLE)


def kallax(cells):
    return {"storages": [{"id": "k", "name": "K", "type": "kallax", "rows": 2, "cols": 2, "cells": cells}], "games": {"a": {"name": "A"}}}


def test_sample_is_valid(data):
    errors, _ = validate(data)
    assert errors == []


def test_unknown_game_reference():
    errors, _ = validate(kallax([{"at": [1, 1], "games": ["a", "ghost"]}]))
    assert any("ghost" in e for e in errors)


def test_duplicate_and_out_of_grid_cells():
    errors, _ = validate(kallax([{"at": [1, 1], "games": ["a"]}, {"at": [1, 1]}, {"at": [3, 1]}]))
    assert any("defined twice" in e for e in errors)
    assert any("outside" in e for e in errors)


def test_drawers_need_two_lists():
    errors, _ = validate(kallax([{"at": [1, 1], "kind": "drawers", "drawers": [["a"]]}]))
    assert any("drawers" in e for e in errors)


def test_build_matches_viewer_schema(data):
    out = build(data, {})
    k = out["storages"][0]["stacks"][0]["units"][0]
    assert {"id", "name", "align", "rows", "cols", "cells"} <= set(k)
    assert {"row", "col", "kind"} <= set(k["cells"][0])
    assert all(c["kind"] != "empty" for c in k["cells"])
    assert out["games"]["wingspan"]["expansions"]["owned"]


def test_build_uses_bgg_data(data):
    bgg = {"wingspan": {"bgg": 266192, "name": "Wingspan", "expansions": ["Wingspan: European Expansion", "Wingspan: Asia"]}}
    exp = build(data, bgg)["games"]["wingspan"]["expansions"]
    assert exp["notOwned"] == ["Wingspan: Asia"]


def test_expansion_matching_is_fuzzy():
    split = split_expansions(["european expansion"], ["Wingspan: European Expansion", "Wingspan: Oceania Expansion"])
    assert split["notOwned"] == ["Wingspan: Oceania Expansion"]


def wall(units, games=("a",)):
    return {"storages": [{"id": "w", "name": "W", "type": "wall", "stacks": [{"units": units}]}], "games": {g: {"name": g} for g in games}}


def test_wall_tops_are_placements():
    errors, warnings = validate(wall([{"id": "b", "rows": 1, "cols": 2, "top": {"layout": "stacked", "games": ["a"]}}]))
    assert errors == [] and warnings == []


def test_wall_upper_unit_cannot_be_wider():
    errors, _ = validate(wall([{"id": "b", "rows": 1, "cols": 2}, {"id": "t", "rows": 1, "cols": 3}]))
    assert any("wider" in e for e in errors)


def test_wall_unit_ids_unique_and_align_checked():
    errors, _ = validate(wall([{"id": "b", "rows": 1, "cols": 2}, {"id": "b", "rows": 1, "cols": 1, "align": "middle"}]))
    assert any("duplicate" in e for e in errors)
    assert any("align" in e for e in errors)


def test_build_wall_keeps_top_and_drops_empty_top():
    out = build(wall([{"id": "b", "rows": 1, "cols": 2, "top": {"games": ["a"]}}, {"id": "t", "rows": 1, "cols": 1, "align": "right", "top": {"games": []}}]), {})
    b, t = out["storages"][0]["stacks"][0]["units"]
    assert b["top"] == {"layout": "standing", "games": ["a"]}
    assert t["align"] == "right" and "top" not in t
