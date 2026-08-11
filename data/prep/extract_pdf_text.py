"""Emit the per-page text of a PDF as JSON, for retrieval.

SIBLING OF measure_pdf.py, NOT A REPLACEMENT. That script already opens every page
and calls `get_text()`, then throws the text away and keeps counts - because its job
is to decide whether a document is usable at all, and a count is the whole answer to
that. This one keeps the text, because retrieval needs the words and, more
importantly, needs to know WHICH PAGE each word was on.

PAGE-LEVEL AND NOT SMALLER, deliberately. Every claim in this system has to be
traceable to a source a human can open and check - spec section 6.5 makes citation a
selection against real objects rather than free text, and findings already carry
`sourcePage`. A chunk that spans a page boundary, or a 400-token window with no page
number, cannot be cited that way: the answer would be groundable in principle and
uncheckable in practice. A page is the smallest unit a reader can actually turn to.

The cost is that pages vary in length and a very long page is a coarse chunk. That is
accepted: precision that cannot be verified is worth less here than a citation
somebody can follow.

Empty pages are DROPPED rather than emitted with empty text. A scanned page yields
zero characters, and keeping it would put a citable page number on a page containing
nothing readable - the same "measured negative vs never measured" confusion spec
section 3.2 exists to prevent, moved into the index.

Usage:  python data/prep/extract_pdf_text.py <file.pdf>
Output: {"ok": true, "pages": [{"page": 1, "text": "..."}], "characters": N}
        {"ok": false, "reason": "..."}   on any failure, with exit code 0 so the
                                          caller reads the reason rather than a stack
"""
from __future__ import annotations

import json
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({
        "ok": False,
        "reason": "PyMuPDF is not installed. pip install -r data/prep/requirements.txt",
    }))
    sys.exit(0)


def extract(path: str) -> dict:
    doc = fitz.open(path)
    try:
        # 1-indexed, because that is what a reader sees on the page and what
        # `sourcePage` already means everywhere else in this project.
        pages = [{"page": i + 1, "text": p.get_text()} for i, p in enumerate(doc)]
    finally:
        doc.close()

    kept = [p for p in pages if p["text"].strip() != ""]
    return {
        "ok": True,
        "pages": kept,
        "pageCount": len(pages),
        "pagesWithText": len(kept),
        "characters": sum(len(p["text"]) for p in kept),
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "reason": "usage: extract_pdf_text.py <file.pdf>"}))
    else:
        try:
            print(json.dumps(extract(sys.argv[1])))
        except Exception as exc:  # noqa: BLE001 - the caller needs the reason, not a trace
            print(json.dumps({"ok": False, "reason": f"Could not read the file: {exc}"}))
