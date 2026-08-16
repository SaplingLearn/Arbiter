"""Re-fetch the approval-package PDFs from accessdata.fda.gov.

WHY THIS IS A SCRIPT AND NOT A LINE IN A README. `data/raw/approval-packages/` is
gitignored, so a fresh clone has none of these files and every eval that touches a
document fails with file-not-found. The obvious instruction - "each is retrievable
from accessdata.fda.gov by the NDA number in its filename" - is true and not
sufficient, because three things about that site are not guessable and each cost
real time to discover:

  1. THE URL IS NOT DERIVABLE FROM THE APPLICATION NUMBER. The directory is the
     POSTING year, which is the approval year or the one after it, and the document
     type changed from `PharmR` to `MultidisciplineR` around 2017. Neither is in the
     NDA number. The verified paths are therefore recorded below rather than
     reconstructed - probing for them is what triggers (3).

  2. A DEFAULT USER AGENT GETS AN "FDA Apology" PAGE. urllib and curl both receive a
     420-byte HTML interstitial with HTTP 200/302, not the PDF. It parses as neither
     an error nor a document, so the failure looks like a corrupt download. A browser
     UA is required.

  3. BURSTS GET 403-ed. Probing ~100 candidate URLs across 5 threads earned this IP a
     block within a minute, on URLs that had served 200 seconds earlier. So: one
     request at a time, a pause between files, and exponential backoff on 403. The
     whole corpus is a few dozen files; there is nothing to gain by going faster and
     a multi-minute lockout to lose.

Usage:  python data/prep/fetch_reviews.py [name ...]
        with no arguments, fetches everything missing.
"""
from __future__ import annotations

import os
import sys
import time
import urllib.error
import urllib.request

OUT = "data/raw/approval-packages"
BASE = "https://www.accessdata.fda.gov/drugsatfda_docs/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# name -> (filename, verified path under drugsatfda_docs/)
# Every path here returned a PDF over 200 KB when it was recorded. The seven
# pharmacology reviews are the v2.1 outcome-selected additions; see
# docs/evaluation-dataset.md section 8.
REVIEWS: dict[str, tuple[str, str]] = {
    "ponatinib":     ("ponatinib-203469-pharmreview.pdf",     "nda/2012/203469Orig1s000PharmR.pdf"),
    "regorafenib":   ("regorafenib-203085-pharmreview.pdf",   "nda/2012/203085Orig1s000PharmR.pdf"),
    "obeticholic":   ("obeticholic-207999-pharmreview.pdf",   "nda/2016/207999Orig1s000PharmR.pdf"),
    "tolvaptan":     ("tolvaptan-204441-pharmreview.pdf",     "nda/2018/204441Orig1s000PharmR.pdf"),
    "teriflunomide": ("teriflunomide-202992-pharmreview.pdf", "nda/2012/202992Orig1s000PharmR.pdf"),
    "trabectedin":   ("trabectedin-207953-pharmreview.pdf",   "nda/2015/207953Orig1s000PharmR.pdf"),
    "mipomersen":    ("mipomersen-203568-pharmreview.pdf",    "nda/2013/203568Orig1s000PharmR.pdf"),
    "turalio":       ("turalio-211810-multidiscipline.pdf",   "nda/2019/211810Orig1s000MultidisciplineR.pdf"),
}

PAUSE_BETWEEN_FILES = 20
MAX_ATTEMPTS = 7


def get(url: str, timeout: int = 600) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/pdf,*/*",
        "Accept-Language": "en-US,en;q=0.9",
    })
    return urllib.request.urlopen(req, timeout=timeout).read()


def fetch(name: str, filename: str, path: str) -> str:
    dest = os.path.join(OUT, filename)
    if os.path.exists(dest) and os.path.getsize(dest) > 200_000:
        return f"HAVE  {name} ({os.path.getsize(dest):,}b)"

    delay = 60
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            body = get(BASE + path)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            code = getattr(exc, "code", type(exc).__name__)
            print(f"  {code} on {name}, attempt {attempt}/{MAX_ATTEMPTS}, sleeping {delay}s", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 900)
            continue

        # The apology interstitial arrives with a 200, so the status code is not the
        # check - the magic number is.
        if body[:5] != b"%PDF-":
            return f"BAD   {name}: served {len(body):,}b that is not a PDF (blocked?)"

        os.makedirs(OUT, exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(body)
        return f"OK    {name} {len(body):,}b"

    return f"MISS  {name} - gave up after {MAX_ATTEMPTS} attempts"


def main(argv: list[str]) -> int:
    wanted = argv or list(REVIEWS)
    unknown = [n for n in wanted if n not in REVIEWS]
    if unknown:
        print(f"unknown: {', '.join(unknown)}\nknown: {', '.join(REVIEWS)}")
        return 2

    todo = [n for n in wanted
            if not (os.path.exists(os.path.join(OUT, REVIEWS[n][0]))
                    and os.path.getsize(os.path.join(OUT, REVIEWS[n][0])) > 200_000)]

    for i, name in enumerate(wanted):
        print(fetch(name, *REVIEWS[name]), flush=True)
        if name in todo and i < len(wanted) - 1:
            time.sleep(PAUSE_BETWEEN_FILES)

    print("\nNext: npx tsx tools/warm_library_cache.ts    # build the extraction caches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
