import argparse
import functools
import http.server
import json
import os
import sys
import webbrowser
from pathlib import Path

from shelf_admin.bgg import BGG, BGGError, resolve
from shelf_admin.model import load_bgg, load_yaml, split_expansions, validate, write_site

ADMIN = Path(__file__).resolve().parents[2]
ROOT = ADMIN.parent
DATA = ADMIN / "data" / "collection.yaml"
BGG_DATA = ADMIN / "data" / "bgg.json"
CACHE = ADMIN / ".cache" / "bgg"
SITE = ROOT / "site"


def load_env():
    env = ADMIN / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


def check(data: dict) -> bool:
    errors, warnings = validate(data)
    for w in warnings:
        print(f"warn:  {w}")
    for e in errors:
        print(f"error: {e}")
    return not errors


def cmd_validate(args):
    ok = check(load_yaml(args.data))
    print("ok" if ok else "invalid")
    return 0 if ok else 1


def cmd_build(args):
    data = load_yaml(args.data)
    if not check(data):
        return 1
    out = write_site(data, BGG_DATA, args.out)
    print(f"wrote {args.out} ({len(out['games'])} games, {len(out['storages'])} storages)")
    return 0


def cmd_bgg(args):
    load_env()
    data = load_yaml(args.data)
    known = load_bgg(BGG_DATA)
    try:
        client = BGG(os.environ.get("BGG_API_TOKEN", ""), CACHE)
        for gid, g in data.get("games", {}).items():
            pinned = g.get("bgg")
            prev = known.get(gid)
            if prev and not args.refresh and (not pinned or prev.get("bgg") == pinned):
                continue
            info, how = resolve(client, g["name"], pinned)
            if not info:
                print(f"  ?  {gid}: {how}")
                continue
            info.pop("usersrated", None)
            known[gid] = info | {"matched": how}
            flag = "  " if how in ("pinned", "exact") else " ~"
            print(f"{flag} {gid}: {info['name']} ({info['year']}) #{info['bgg']} [{how}]")
    except BGGError as e:
        print(f"error: {e}")
        return 1
    finally:
        if known:
            BGG_DATA.write_text(json.dumps(known, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("~ = picked most rated candidate; pin `bgg: <id>` in collection.yaml if wrong")
    return 0


def cmd_expansions(args):
    data = load_yaml(args.data)
    bgg = load_bgg(BGG_DATA)
    ids = [args.game] if args.game else [gid for gid in data.get("games", {}) if bgg.get(gid, {}).get("expansions")]
    for gid in ids:
        g, info = data["games"].get(gid), bgg.get(gid)
        if not g or not info:
            print(f"{gid}: no BGG data (run `shelf-admin bgg`)")
            continue
        split = split_expansions(g.get("expansions") or [], info["expansions"])
        print(f"{g['name']} — {len(split['owned'])} owned, {len(split['notOwned'])} not owned")
        for name in g.get("expansions") or []:
            print(f"  [x] {name}")
        for name in split["notOwned"]:
            print(f"  [ ] {name}")
    return 0


def cmd_serve(args):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SITE))
    print(f"http://localhost:{args.port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()


def cmd_admin(args):
    from shelf_admin.server import make_server

    server = make_server(args.port, args.data, BGG_DATA, SITE)
    url = f"http://localhost:{server.server_address[1]}/"
    print(f"admin: {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


def main():
    p = argparse.ArgumentParser(prog="shelf-admin")
    p.add_argument("--data", type=Path, default=DATA)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate", help="check collection.yaml").set_defaults(fn=cmd_validate)
    b = sub.add_parser("build", help="write site/collection.json")
    b.add_argument("--out", type=Path, default=SITE / "collection.json")
    b.set_defaults(fn=cmd_build)
    g = sub.add_parser("bgg", help="match games on BoardGameGeek, fetch expansions")
    g.add_argument("--refresh", action="store_true")
    g.set_defaults(fn=cmd_bgg)
    e = sub.add_parser("expansions", help="list owned / missing expansions")
    e.add_argument("game", nargs="?")
    e.set_defaults(fn=cmd_expansions)
    s = sub.add_parser("serve", help="preview the site locally")
    s.add_argument("--port", type=int, default=8000)
    s.set_defaults(fn=cmd_serve)
    a = sub.add_parser("admin", help="edit storages and game placement in the browser")
    a.add_argument("--port", type=int, default=8001)
    a.add_argument("--no-browser", action="store_true")
    a.set_defaults(fn=cmd_admin)
    args = p.parse_args()
    sys.exit(args.fn(args) or 0)
