#!/usr/bin/env python3
"""
scripts/list-top.py

极简 CLI 浏览素材库（Python 3 标准库，零依赖）。
任何装了 python3 的 Linux/Mac 上直接可用：

  python3 scripts/list-top.py --help
  python3 scripts/list-top.py -n 20 --sort likeCount
  python3 scripts/list-top.py --topic 沙坡头 --sort collectCount
  python3 scripts/list-top.py --city 中卫
  python3 scripts/list-top.py --removed-only
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, Iterable, List

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DEFAULT_INDEX = os.path.join(ROOT, "data", "notes-index.json")


def load_index(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"[错误] notes-index.json 不存在: {path}", file=sys.stderr)
        print("请先跑至少一次 ingest-one 以生成索引，或手动创建空 [] 对象。", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"[错误] notes-index.json 不是合法 JSON: {e}", file=sys.stderr)
        sys.exit(1)


def entry_matches(entry: Dict[str, Any], args: argparse.Namespace) -> bool:
    if args.removed_only and not entry.get("removed", False):
        return False
    if args.not_removed and entry.get("removed", False):
        return False
    if args.topic:
        kw = args.topic
        if kw not in " ".join(entry.get("topics", []) or []):
            # 顺便扫 title / geo / author
            haystack = " ".join([
                entry.get("title", "") or "",
                entry.get("geoHintCity", "") or "",
                entry.get("geoHintAttraction", "") or "",
            ])
            if kw not in haystack:
                return False
    if args.city:
        if args.city != (entry.get("geoHintCity") or ""):
            return False
    if args.attraction:
        a = args.attraction
        attr = entry.get("geoHintAttraction") or ""
        title = entry.get("title") or ""
        if a not in attr and a not in title:
            return False
    if args.min_likes is not None:
        if (entry.get("likeCount") or 0) < args.min_likes:
            return False
    return True


def sort_key(entry: Dict[str, Any], mode: str):
    likes = entry.get("likeCount") or 0
    collects = entry.get("collectCount") or 0
    comments = entry.get("commentCount") or 0
    if mode == "likeCount":
        return (likes, collects, comments)
    if mode == "collectCount":
        return (collects, likes, comments)
    if mode == "commentCount":
        return (comments, likes, collects)
    if mode == "publishedAt":
        return (entry.get("publishedAt") or "", likes)
    if mode == "fetchedAt":
        return (entry.get("fetchedAt") or "", likes)
    # score = like + 2*collect
    return (likes + 2 * collects, likes, comments)


def render_table(rows: List[Dict[str, Any]]) -> str:
    cols = [
        ("#", 3),
        ("noteId", 18),
        ("点赞", 5),
        ("收藏", 5),
        ("评论", 5),
        ("发布", 10),
        ("作者", 12),
        ("城市", 6),
        ("标题", 38),
    ]
    out: List[str] = []
    header = "  ".join(c[0].ljust(c[1]) for c in cols)
    out.append(header)
    out.append("-" * (sum(c[1] for c in cols) + 2 * (len(cols) - 1)))
    for i, row in enumerate(rows, start=1):
        values = [
            str(i),
            (row.get("noteId") or "")[:18],
            str(row.get("likeCount") or 0),
            str(row.get("collectCount") or 0),
            str(row.get("commentCount") or 0),
            (row.get("publishedAt") or "-")[:10],
            (row.get("authorNickname") or "")[:12],
            (row.get("geoHintCity") or "-")[:6],
            (row.get("title") or "(无标题)")[:38],
        ]
        line = "  ".join(str(v).ljust(c[1]) for v, c in zip(values, cols))
        out.append(line)
    return "\n".join(out)


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="list-top.py",
        description="浏览 XHS 素材库索引的极简 CLI（Python 3 标准库，零依赖）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="\n".join([
            "示例:",
            "  python3 scripts/list-top.py -n 20 --sort likeCount",
            "  python3 scripts/list-top.py --topic 沙坡头 --sort score",
            "  python3 scripts/list-top.py --city 中卫 --min-likes 100",
            "  python3 scripts/list-top.py --removed-only",
        ]),
    )
    p.add_argument("--index", default=DEFAULT_INDEX, help=f"notes-index.json 路径 (默认: {DEFAULT_INDEX})")
    p.add_argument("-n", type=int, default=20, help="显示条数 (默认 20)")
    p.add_argument(
        "--sort",
        choices=["score", "likeCount", "collectCount", "commentCount", "publishedAt", "fetchedAt"],
        default="score",
        help="排序字段（score=like+2×collect）",
    )
    p.add_argument("--topic", type=str, help="按关键词搜索（topics[] 或 标题/geo）")
    p.add_argument("--city", type=str, help="按 geoHintCity 精确过滤（银川 / 石嘴山 / 吴忠 / 固原 / 中卫）")
    p.add_argument("--attraction", type=str, help="按景区名模糊过滤")
    p.add_argument("--min-likes", type=int, help="最少点赞数")
    p.add_argument("--removed-only", action="store_true", help="仅显示已下架条目")
    p.add_argument("--not-removed", action="store_true", help="仅显示未下架条目 (默认会同时显示，除非显式指定)")
    p.add_argument("--json", action="store_true", help="输出 JSON 而不是表格")
    return p


def main(argv: Iterable[str] | None = None) -> int:
    args = build_arg_parser().parse_args(list(argv) if argv is not None else None)
    index = load_index(args.index)
    if isinstance(index, list):
        # 兼容空 [] 对象
        entries: List[Dict[str, Any]] = []
    else:
        entries = list(index.values())
    entries = [e for e in entries if entry_matches(e, args)]
    entries.sort(key=lambda e: sort_key(e, args.sort), reverse=args.sort in ("score", "likeCount", "collectCount", "commentCount"))
    top = entries[: max(0, args.n)]
    if args.json:
        print(json.dumps({
            "total": len(entries),
            "shown": len(top),
            "sort": args.sort,
            "entries": top,
        }, ensure_ascii=False, indent=2))
        return 0
    print(f"共匹配 {len(entries)} 条，显示 Top {len(top)} | 排序: {args.sort}")
    print()
    if not top:
        print("(空)")
        return 0
    print(render_table(top))
    return 0


if __name__ == "__main__":
    sys.exit(main())
