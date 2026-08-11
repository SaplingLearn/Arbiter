# Data prep

## DILIrank (manual download - no stable direct URL)

1. Go to the FDA Liver Toxicity Knowledge Base (LTKB) DILIrank page.
2. Download the DILIrank dataset spreadsheet (`.xlsx`).
3. Save it as `data/raw/dilirank.xlsx`.

We do not script this download: the FDA URL is not stable and silently returning
an HTML error page as a "spreadsheet" is a worse failure than asking a human to
click once.

`data/raw/` is deliberately **not** gitignored. The workbook is 110KB of
US-government public-domain data, and committing it pins the exact dataset
version a result came from - DILIrank 2.0 reclassified 49 drugs relative to 1.0,
so "which version" is part of any result's provenance.

### Two sheets, and they are not interchangeable

| sheet | dataset | drugs |
|-------|---------|-------|
| 0 | DILIrank **2.0** - use this one | 1,336 |
| 1 | DILIrank 1.0, superseded | 1,036 |

Row 0 of each sheet is a title banner, so every reader must pass `header=1`.
With the default `header=0` every column comes back as `Unnamed: N`.

2.0 columns: `LTKBID`, `CompoundName`, `SeverityClass`, `LabelSection`,
`vDILI-Concern`, `Comment`. Note that `SeverityClass` (an integer grade)
precedes the label column, so a column lookup matching `"severity"` selects the
wrong one.

### Category strings are internally inconsistent - always normalise

The file mixes case and punctuation (`vMost-DILI-concern` 215 rows vs
`vMOST-DILI-concern` 2; `vNo-DILI-concern` 413 vs `vNo-DILI-Concern` 1), and
sheet 1 drops the `v` prefix entirely and writes `Ambiguous DILI-concern` with a
space. Compare labels only after passing both sides through the same
`norm_label()` (lowercase, strip non-letters). A hand-written alias table would
also drop rows.

## PubChem name → SMILES

PubChem renamed its SMILES properties. Requesting `property/CanonicalSMILES`
still returns HTTP 200 but the JSON key is now **`ConnectivitySMILES`**, so code
that looks up `props[0]["CanonicalSMILES"]` finds nothing and resolves zero
compounds while every request "succeeds". Request `property/SMILES` and read the
first key containing `SMILES`.

Resolutions are cached in `data/out/smiles-cache.json` so a re-run does not
re-hit the API.

## Everything else

Scripted. Run with `data/prep/.venv/Scripts/python data/prep/<script>.py`.

Environment:

```bash
python -m venv data/prep/.venv
data/prep/.venv/Scripts/python -m pip install -r data/prep/requirements.txt
```
