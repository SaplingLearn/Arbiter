# case_1303693510 — Tucatinib (TUKYSA), FDA NDA 213411

The deliberation record behind `docs/tucatinib-case-record.html`, as the service wrote
it. The page is a transcription; this is the thing transcribed.

## Why it is in git at all

Everything else the tucatinib case rests on was already tracked, and this was not:

| Layer | Where it lives | Re-derivable? |
| --- | --- | --- |
| The source document | `data/raw/approval-packages/tucatinib-213411-multidiscipline.pdf`, sha256 `a967fc68…` | yes, it is a fixed file |
| The nine findings and three positions | `services/api/demo-fixture.ts`, keyed on that same sha256 | yes, they are source |
| The one-page record | `docs/tucatinib-case-record.html` | yes, it is source |
| **This: the deliberation itself** | **nowhere** | **no** |

Not re-derivable for two reasons. `tools/demo-tucatinib.mjs` opens a NEW case on every
run — new case id, new user ids, new timestamps, a new hash chain — because the record
is append-only and nothing deletes a case. And seq 9 is a live billed model call, which
is free to answer differently the next time it is asked. Re-running the demo produces
*a* tucatinib case; it does not produce *this* one, and this one is what the page cites.

Until this commit the only copy was an untracked `results/` directory inside a harness
worktree under `.claude/worktrees/`, which is both gitignored and disposable. One
`git worktree remove` and the evidence behind a published page would have been gone
while the page went on citing it.

## What is here

- `deliberation-log.jsonl` — the ten-event hash chain, byte-identical to what the
  service wrote (sha256 `ed3987fbc4751fcc9c7251393d68e1de22f8c54bd5f2a30b009a9ec903e0c9f7`).
- `case.json` — the case-store entry: context, seats, the three revealed positions, the
  adjudication, and the consensus probe.
- `document.json` — the uploaded document's metadata and readability measurement. The
  bytes are not duplicated here; `sha256` points at the tracked PDF above.
- `participants.json` — the four account ids the log refers to, mapped to names, so
  `u_523931e4c0d0f42fc7` reads as a person.

## What is deliberately NOT here

`passwordHash`, `salt`, and the session and reset tables from the account store. They
are the reason `*.users.json` is gitignored, and that rule is right: a repository is not
where credentials live, even scrypted, even for demo accounts. `participants.json`
carries identity, not authentication.

## The chain

Ten entries, verified with the product's own `verifyChain` and `commitmentFor`:

```
seq 0  case_opened          R. Okafor opens the case
seq 1  inventory_published  twelve checklist questions, nine answered
seq 2  demo_seeded          fixture named in the record BEFORE anything it seeded
seq 3  case_opened          the nine findings, with page and verbatim quote
seq 4  inventory_published  the checklist re-published over them
seq 5  position_sealed      C. Lindqvist (clinical)
seq 6  position_sealed      B. Mehta (DMPK)
seq 7  position_sealed      A. Silva (toxicology)
seq 8  revealed             do_not_advance / advance / cannot_conclude — a three-way split
seq 9  adjudicated          verdict "advance", six rules disclosed, two unrunnable
```

Chain failures: none. All three seals hash to the commitments written while the case was
still open, so the answers read at seq 8 are the answers submitted at seq 5–7.

Seq 3 and 4 carry `at: 1970-01-01T00:00:00.000Z`. That is the fixture seeding writing an
epoch timestamp rather than a clock reading, and it is preserved rather than corrected:
the hash covers the timestamp, so "fixing" it would break the chain and destroy the one
property the record exists to have.

The case is **unsigned** — `signature` is null. `tools/demo-tucatinib.mjs` never
automates a signature, deliberately, because a signature is a named person taking
responsibility for a decision. This record stops one keystroke short of that, and it
should be read as a completed deliberation rather than as a decision anyone signed.

## Verify it yourself

```
npx tsx tools/verify-case-record.ts results/cases/case_1303693510/deliberation-log.jsonl
```

## The caution this case carries

Two of the nine findings — `tuc-clinical-hepatotox` and `tuc-hys-law` — are transcribed
from the clinical safety section at pages 189–190. They are outcomes, not predictors.
This case exercises the deliberation and **must never be used to score prediction**, on
the same reasoning the turalio fixture carries.
