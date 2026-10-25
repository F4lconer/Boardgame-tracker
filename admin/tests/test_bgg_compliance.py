"""Guards for the BGG XML API Terms of Use. See BGG_RULES.md before changing any of these."""

import re
from html.parser import HTMLParser
from pathlib import Path

from shelf_admin.bgg import MIN_DELAY, BGG
from shelf_admin.model import build, load_yaml

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
LOGO = SITE / "img" / "powered-by-bgg.webp"


class LinkedImages(HTMLParser):
    def __init__(self):
        super().__init__()
        self.href = None
        self.found = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a":
            self.href = a.get("href")
        elif tag == "img" and self.href:
            self.found.append((self.href, a))

    def handle_endtag(self, tag):
        if tag == "a":
            self.href = None


def test_powered_by_bgg_logo_linked_in_page():
    parser = LinkedImages()
    parser.feed((SITE / "index.html").read_text(encoding="utf-8"))
    logos = [
        (href, img) for href, img in parser.found
        if re.match(r"https://(www\.)?boardgamegeek\.com/?$", href) and img.get("src") == "img/powered-by-bgg.webp"
    ]
    assert logos, "index.html must show img/powered-by-bgg.webp linked to https://boardgamegeek.com"
    assert "powered by bgg" in logos[0][1].get("alt", "").lower()
    assert int(logos[0][1].get("height", 0)) >= 48, "logo must be large enough to be legible"


def test_powered_by_bgg_logo_file_present():
    assert LOGO.exists() and LOGO.stat().st_size > 0, (
        "Missing site/img/powered-by-bgg.webp - download the official logo from "
        "https://boardgamegeek.com/using_the_xml_api"
    )


def test_bgg_named_as_data_source():
    html = (SITE / "index.html").read_text(encoding="utf-8")
    assert re.search(r"Game data from .*BoardGameGeek", html)


def test_bgg_names_not_modified():
    data = load_yaml(ROOT / "admin" / "data" / "collection.yaml")
    names = ["Wingspan: Asia", "Wingspan: European Expansion – Swift Start"]
    out = build(data, {"wingspan": {"bgg": 266192, "name": "Wingspan", "expansions": names}})
    for n in out["games"]["wingspan"]["expansions"]["notOwned"]:
        assert n in names


def test_request_delay_cannot_go_below_minimum(tmp_path):
    assert MIN_DELAY >= 5
    assert BGG("token", tmp_path, delay=0).delay >= MIN_DELAY
