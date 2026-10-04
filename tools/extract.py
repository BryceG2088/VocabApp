"""Extract the 重点生词 table from a study-guide PDF."""
import re
import unicodedata

import pdfplumber

HEAD = "重点生词"
TAIL = "词语搭配"


def clean(s: str) -> str:
    # NFKC folds Kangxi radical lookalikes (⼦ ⾏ ⼤ ...) into normal hanzi
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("...", "…").replace(":", "：")
    return re.sub(r"\s+", " ", s).strip()


def split_row(line: str) -> list[str]:
    # cells are separated by spaces, but a few contain one, e.g. "(对 sth.)嗤之以鼻"
    line = re.sub(r"\(([^()]*?) ([^()]*?)\)", lambda m: f"({m.group(1)}\u0000{m.group(2)})", line)
    return [c.replace("\u0000", " ") for c in line.split()]


def extract_terms(pdf_path: str) -> list[str]:
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    text = unicodedata.normalize("NFKC", text)
    start = text.find(HEAD)
    if start < 0:
        raise ValueError(f"No '{HEAD}' section in {pdf_path}")
    end = text.find(TAIL, start)
    body = text[start + len(HEAD): end if end > 0 else len(text)]
    terms = []
    for line in body.splitlines():
        line = line.strip()
        # stop at stray page footers, page numbers, or the section marker "v"
        if not line or re.fullmatch(r"[vV\d]+", line) or "Study Guide" in line:
            continue
        terms += [clean(c) for c in split_row(line)]
    return [t for t in terms if t]
