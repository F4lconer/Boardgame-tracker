import hashlib
import io
import json
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.scalarstring import DoubleQuotedScalarString


def _yaml() -> YAML:
    y = YAML()
    y.preserve_quotes = True
    y.width = 4096
    y.indent(mapping=2, sequence=4, offset=2)
    return y


def version(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16] if path.exists() else ""


def _ident(x):
    if isinstance(x, dict):
        for k in ("id", "at"):
            if k in x:
                return k, json.dumps(list(x[k]) if isinstance(x[k], list) else x[k])
    return None


def _flow_map(path: tuple) -> bool:
    return (
        (len(path) >= 2 and path[-2] in ("cells", "shelves"))
        or (bool(path) and path[-1] == "top")
        or (len(path) == 2 and path[0] == "games")
    )


def _quoted(path: tuple) -> bool:
    return bool(path) and path[0] == "games" and (path[-1] == "name" or (len(path) >= 2 and path[-2] == "expansions"))


def merge(old, new, path: tuple = ()):
    if isinstance(new, dict):
        out = old if isinstance(old, CommentedMap) else CommentedMap()
        for k in [k for k in out if k not in new]:
            del out[k]
        for k, v in new.items():
            out[k] = merge(out.get(k), v, path + (k,))
        if out is not old and _flow_map(path):
            out.fa.set_flow_style()
        return out
    if isinstance(new, list):
        out = old if isinstance(old, CommentedSeq) else CommentedSeq()
        prev = list(out)
        by_id = {_ident(o): o for o in prev if _ident(o)}
        items = []
        for i, v in enumerate(new):
            key = _ident(v)
            o = by_id.pop(key, None) if key else (prev[i] if i < len(prev) and not _ident(prev[i]) else None)
            items.append(merge(o, v, path + (i,)))
        list.clear(out)
        list.extend(out, items)
        if out is not old and all(not isinstance(v, dict) for v in new):
            out.fa.set_flow_style()
        return out
    if isinstance(old, str) and old == new:
        return old
    if isinstance(new, str) and _quoted(path):
        return DoubleQuotedScalarString(new)
    return new


def _loose(line: str) -> bool:
    return not line.strip() or line.lstrip().startswith("#")


def restore_comments(original: str, dumped: str) -> str:
    blocks, buf = [], []
    for ln in original.splitlines():
        if _loose(ln):
            buf.append(ln)
        elif buf:
            blocks.append((ln, buf))
            buf = []
    body = [ln for ln in dumped.splitlines() if not _loose(ln)]
    out, pos = [], 0
    for anchor, lines in blocks:
        idx = next((i for i in range(pos, len(body)) if body[i] == anchor), None)
        if idx is not None:
            out += body[pos:idx] + lines
            pos = idx
    return "\n".join(out + body[pos:] + buf) + "\n"


def save(path: Path, data: dict) -> None:
    raw = path.read_bytes() if path.exists() else b""
    text = raw.decode("utf-8").replace("\r\n", "\n")
    y = _yaml()
    buf = io.StringIO()
    y.dump(merge(y.load(text) if text else None, data), buf)
    newline = "\r\n" if b"\r\n" in raw else "\n"
    path.write_text(restore_comments(text, buf.getvalue()), encoding="utf-8", newline=newline)
