"""Corpus utility.

  python tools/vocab_tool.py build                 # rebuild corpus from every PDF in StudyGuides/
  python tools/vocab_tool.py add path/to/guide.pdf # add one new study guide to the corpus
  python tools/vocab_tool.py curated [file.json]   # add hand-curated sets from data/curated/

Pinyin comes from pypinyin. English comes from data/translations.json; any term not
in there is machine-translated (Google via deep-translator, no key needed), shortened,
and saved back to translations.json flagged in data/needs_review.txt so you can fix it.
"""
import glob
import json
import os
import re
import sys
import time

from pypinyin import Style, pinyin

sys.path.insert(0, os.path.dirname(__file__))
from extract import extract_terms  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRANS = os.path.join(ROOT, "data", "translations.json")
REVIEW = os.path.join(ROOT, "data", "needs_review.txt")
OUT = os.path.join(ROOT, "docs", "vocab.json")
GUIDES = os.path.join(ROOT, "StudyGuides")

HAN = re.compile(r"[一-鿿]+")
OVERRIDES = {"为时尚早": "wéi shí shàng zǎo", "颇(为)": "pō (wéi)"}


def to_pinyin(term: str) -> str:
    if term in OVERRIDES:
        return OVERRIDES[term]
    out, pos = [], 0
    for m in HAN.finditer(term):
        out.append(term[pos:m.start()])
        syl = pinyin(m.group(), style=Style.TONE)
        out.append(" ".join(s[0] for s in syl))
        pos = m.end()
    out.append(term[pos:])
    s = "".join(out)
    s = re.sub(r"\s*([/+…])\s*", r" \g<1> ", s)
    s = re.sub(r"\s*：\s*", ": ", s)
    s = re.sub(r"(\S)\(", r"\g<1> (", s)
    s = re.sub(r"\)(\S)", r") \g<1>", s)
    s = s.replace("( ", "(").replace(" )", ")")
    return re.sub(r"\s+", " ", s).strip()


def shorten(text: str, limit: int = 40) -> str:
    text = re.sub(r"\s*\(.*?\)", "", text).strip().rstrip(".")
    parts = [p.strip() for p in re.split(r"[;,]", text) if p.strip()]
    out = ""
    for p in parts:
        cand = f"{out}; {p}" if out else p
        if len(cand) > limit and out:
            break
        out = cand
    return out or text[:limit]


def machine_translate(term: str, tries: int = 6) -> str:
    from deep_translator import GoogleTranslator
    clean = re.sub(r"[()（）+]", " ", term)
    for i in range(tries):
        try:
            out = GoogleTranslator(source="zh-CN", target="en").translate(clean)
            return shorten(out.lower())
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * 2 ** i)  # back off: Google rate-limits free requests


def load_json(path, default):
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else default


def ensure_translations(terms):
    trans = load_json(TRANS, {})
    new = []
    for t in terms:
        if trans.get(t):  # blank entries from earlier failures are retried
            continue
        try:
            trans[t] = machine_translate(t)
            new.append(t)
            time.sleep(0.5)
        except Exception as e:
            print(f"  ! could not translate {t}: {e}")
            trans.pop(t, None)
    json.dump(trans, open(TRANS, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    if new:
        with open(REVIEW, "a", encoding="utf-8") as f:
            f.writelines(f"{t}\t{trans[t]}\n" for t in new)
        print(f"  {len(new)} machine-translated terms appended to data/needs_review.txt")
    return trans


def guide_no(path: str) -> int | None:
    m = re.match(r"(\d+)", os.path.basename(path))
    return int(m.group(1)) if m else None


def merge(paths):
    corpus = load_json(OUT, [])
    have = {c["hanzi"] for c in corpus}
    for path in paths:
        terms = extract_terms(path)
        trans = ensure_translations(terms)
        added = 0
        for t in terms:
            if t in have or not trans.get(t):
                continue
            have.add(t)
            corpus.append({"hanzi": t, "pinyin": to_pinyin(t), "english": trans[t],
                           "guide": guide_no(path)})
            added += 1
        print(f"{os.path.basename(path)}: {len(terms)} terms, {added} new")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(corpus, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"corpus size: {len(corpus)} -> docs/vocab.json")


def merge_curated(paths):
    """Hand-curated sets: {"deck": name, "terms": [[hanzi, english], ...]} (pinyin is generated)."""
    corpus = load_json(OUT, [])
    have = {c["hanzi"] for c in corpus}
    for path in paths:
        data = load_json(path, {})
        added = 0
        for hanzi, english in data["terms"]:
            if hanzi in have:
                print(f"  skip duplicate: {hanzi}")
                continue
            have.add(hanzi)
            corpus.append({"hanzi": hanzi, "pinyin": to_pinyin(hanzi), "english": english,
                           "deck": data["deck"]})
            added += 1
        print(f"{os.path.basename(path)}: {len(data['terms'])} terms, {added} new")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(corpus, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"corpus size: {len(corpus)} -> docs/vocab.json")


CURATED = sorted(glob.glob(os.path.join(ROOT, "data", "curated", "*.json")))

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "build":
        if os.path.exists(OUT):
            os.remove(OUT)
        merge(sorted(glob.glob(os.path.join(GUIDES, "*.pdf"))))
        merge_curated(CURATED)
    elif cmd == "curated":
        merge_curated(sys.argv[2:] or CURATED)
    elif cmd == "add" and len(sys.argv) > 2:
        merge(sys.argv[2:])
    else:
        print(__doc__)
