import json
import re
from pathlib import Path

import yaml

KINDS = {"open", "doors", "drawers", "empty"}
LAYOUTS = {"standing", "stacked"}
SIZES = {"small", "standard", "large"}
ALIGNS = {"left", "right"}


def load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def load_bgg(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def kallax_units(s: dict):
    if s.get("type") == "kallax":
        yield s
    elif s.get("type") == "wall":
        for st in s.get("stacks") or []:
            yield from st.get("units") or []


def placements(data: dict):
    for s in data.get("storages", []):
        for u in kallax_units(s):
            for c in u.get("cells", []):
                yield from c.get("games", [])
                for d in c.get("drawers", []):
                    yield from d
            yield from (u.get("top") or {}).get("games", [])
        for sh in s.get("shelves", []) if s.get("type") == "shelf" else []:
            yield from sh.get("games", [])


def validate_kallax(u: dict, where: str, errors: list[str]):
    rows, cols = u.get("rows"), u.get("cols")
    if not (isinstance(rows, int) and isinstance(cols, int) and rows > 0 and cols > 0):
        errors.append(f"{where}: rows/cols must be positive integers")
        return
    taken = set()
    for c in u.get("cells") or []:
        at = c.get("at")
        if not (isinstance(at, list) and len(at) == 2):
            errors.append(f"{where}: cell needs at: [row, col]")
            continue
        r, col = at
        cw = f"{where} cell {r},{col}"
        if not (1 <= r <= rows and 1 <= col <= cols):
            errors.append(f"{cw}: outside {rows}x{cols} grid")
        if (r, col) in taken:
            errors.append(f"{cw}: defined twice")
        taken.add((r, col))
        kind = c.get("kind", "open")
        if kind not in KINDS:
            errors.append(f"{cw}: unknown kind {kind!r}")
        if kind == "drawers":
            dr = c.get("drawers")
            if not (isinstance(dr, list) and len(dr) == 2):
                errors.append(f"{cw}: drawers must be [[top...], [bottom...]]")
        elif c.get("layout", "standing") not in LAYOUTS:
            errors.append(f"{cw}: unknown layout {c.get('layout')!r}")
    top = u.get("top")
    if top is not None and (top.get("layout", "standing") not in LAYOUTS or not isinstance(top.get("games", []), list)):
        errors.append(f"{where} top: needs layout standing|stacked and a games list")


def validate(data: dict) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    games = data.get("games") or {}
    seen_ids = set()

    for s in data.get("storages") or []:
        sid = s.get("id")
        where = f"storage {sid!r}"
        if not sid:
            errors.append("storage without id")
        elif sid in seen_ids:
            errors.append(f"{where}: duplicate id")
        seen_ids.add(sid)

        if s.get("type") == "kallax":
            validate_kallax(s, where, errors)
        elif s.get("type") == "wall":
            stacks = s.get("stacks") or []
            if not stacks:
                errors.append(f"{where}: wall needs stacks")
            unit_ids = set()
            for si, st in enumerate(stacks, 1):
                units = st.get("units") or []
                if not units:
                    errors.append(f"{where} stack {si}: needs units (bottom to top)")
                for ui, u in enumerate(units):
                    uw = f"{where} unit {u.get('id')!r}"
                    if not u.get("id") or u["id"] in unit_ids:
                        errors.append(f"{uw}: unit id missing or duplicate")
                    unit_ids.add(u.get("id"))
                    if u.get("align", "left") not in ALIGNS:
                        errors.append(f"{uw}: align must be left or right")
                    validate_kallax(u, uw, errors)
                    if ui and isinstance(u.get("cols"), int) and isinstance(units[ui - 1].get("cols"), int) and u["cols"] > units[ui - 1]["cols"]:
                        errors.append(f"{uw}: wider than the unit below it")
        elif s.get("type") == "shelf":
            for i, sh in enumerate(s.get("shelves") or [], 1):
                if sh.get("layout", "standing") not in LAYOUTS:
                    errors.append(f"{where} shelf {i}: unknown layout {sh.get('layout')!r}")
        else:
            errors.append(f"{where}: type must be kallax, wall or shelf")

    placed = list(placements(data))
    for gid in sorted(set(placed) - set(games)):
        errors.append(f"game {gid!r} is placed but not defined under games")
    for gid in sorted(set(games) - set(placed)):
        warnings.append(f"game {gid!r} is defined but not placed anywhere")
    for gid, g in games.items():
        if not (g or {}).get("name"):
            errors.append(f"game {gid!r}: missing name")
        if (g or {}).get("size", "standard") not in SIZES:
            errors.append(f"game {gid!r}: size must be small/standard/large")
    return errors, warnings


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def split_expansions(owned: list[str], available: list[str]) -> dict:
    owned_norm = [norm(o) for o in owned]
    not_owned = [a for a in available if not any(o and o in norm(a) for o in owned_norm)]
    return {"owned": list(owned), "notOwned": not_owned}


def build_kallax(u: dict) -> dict:
    out = {"rows": u["rows"], "cols": u["cols"], "cells": []}
    for c in u.get("cells", []):
        kind = c.get("kind", "open")
        if kind == "empty":
            continue
        cell = {"row": c["at"][0], "col": c["at"][1], "kind": kind}
        if kind == "drawers":
            cell["drawers"] = c["drawers"]
        else:
            cell |= {"layout": c.get("layout", "standing"), "games": c.get("games", [])}
        out["cells"].append(cell)
    if (u.get("top") or {}).get("games"):
        out["top"] = {"layout": u["top"].get("layout", "standing"), "games": u["top"]["games"]}
    return out


def build(data: dict, bgg: dict) -> dict:
    storages = []
    for s in data["storages"]:
        out = {"id": s["id"], "name": s["name"], "type": s["type"]}
        if s["type"] == "kallax":
            out |= build_kallax(s)
        elif s["type"] == "wall":
            out["stacks"] = [
                {"units": [{"id": u["id"], "name": u.get("name", u["id"]), "align": u.get("align", "left")} | build_kallax(u) for u in st["units"]]}
                for st in s["stacks"]
            ]
        else:
            out |= {
                "width": s.get("width", 3),
                "shelves": [{"layout": sh.get("layout", "standing"), "games": sh.get("games", [])} for sh in s.get("shelves", [])],
            }
        storages.append(out)

    games = {}
    for gid, g in data["games"].items():
        info = bgg.get(gid, {})
        game = {"name": g["name"]}
        bgg_id = g.get("bgg") or info.get("bgg")
        if bgg_id:
            game["bgg"] = bgg_id
        for key in ("size", "color"):
            if g.get(key):
                game[key] = g[key]
        if info.get("thumbnail"):
            game["thumbnail"] = info["thumbnail"]
        exp = split_expansions(g.get("expansions") or [], info.get("expansions") or [])
        if exp["owned"] or exp["notOwned"]:
            game["expansions"] = exp
        games[gid] = game

    return {"version": 1, "storages": storages, "games": games}


def write_site(data: dict, bgg_path: Path, out: Path) -> dict:
    result = build(data, load_bgg(bgg_path))
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result
