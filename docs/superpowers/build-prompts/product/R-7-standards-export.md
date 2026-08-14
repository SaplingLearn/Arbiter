# R-7: Standards export, honestly scoped

| | |
|---|---|
| **Priority** | Post-submission. Lowest of the product set. |
| **Estimated effort** | PROV-O 2 days. QAF 3 days. SEND is a research task, not an engineering one. |
| **Depends on** | nothing |
| **Touches** | `services/api/provenance.ts` (new), `services/api/store.ts` (read only) |

---

## What this is and is not

The Evidence-Integrated Playbook lists four standards that "make the output legible to a
regulator": OECD (Q)SAR Assessment Framework, ASME V&V40 with the FDA's November 2023
credibility guidance, CDISC SEND, and W3C PROV-O.

They are **not equally buildable**, and a prompt that pretended otherwise would waste
days. Ranked by honest feasibility against what this repository actually holds:

| standard | feasibility | why |
|---|---|---|
| **PROV-O** | **Real, and small.** Build this first. | The hash-chained log already records agent, activity, time and derivation. PROV-O is a natural emission format for data that exists. |
| **OECD QAF** | **Real, with a caveat.** | The four QAF principles map onto fields the engine already carries. The second edition's result-reporting format for combining multiple predictions is close to what fusion produces. |
| **ASME V&V40** | **A document, not code.** | It is a risk-informed credibility argument structured on model influence times decision consequence. Writing it is valuable and it is prose. |
| **CDISC SEND** | **Do not build.** | SEND is a submission dataset standard for nonclinical study data. This repository has no SEND data and no access to any. A mapping written without a real SEND dataset would be a schema sketch presented as an integration, which is the kind of claim this project has already corrected once. |

**Build PROV-O. Then QAF. Write V&V40 as prose. Leave SEND as a roadmap slide with an
explicit statement that it is unbuilt.**

---

## Part 1: PROV-O emission

### What exists

`services/api/store.ts` appends `LogEntry` records to `results/deliberation-log.jsonl`:

```ts
{ seq, at, kind, caseId, actorId, payload, prevHash, hash }
```

Ten entry kinds including `case_opened`, `inventory_published`, `participant_added`,
`participant_removed`, `case_described`, `position_sealed`, `revealed`, `adjudicated`,
`signed`. Hash chaining is `sha256(canonicalJson({seq, at, kind, caseId, actorId, payload, prevHash}))`
with a genesis of 64 zeros, and the chain is **global rather than per case** so that
deleting a whole case would still leave a detectable hole.

There is no PROV-O, no RDF, no JSON-LD anywhere. Verify:

```bash
git grep -rniE "prov-o|prov:|jsonld|json-ld|@context|rdf" -- services apps packages | grep -v InChI
```

### The mapping

PROV-O's three core classes map cleanly, which is what makes this worth doing:

| PROV-O | ARBITER |
|---|---|
| `prov:Agent` | the account in `actorId`, plus `"model"` or `"stub"` for an adjudication |
| `prov:Activity` | the log entry's `kind` |
| `prov:Entity` | the case, the inventory, a sealed position, the adjudication, the signature |
| `prov:wasGeneratedBy` | entity to the activity that produced it |
| `prov:wasAssociatedWith` | activity to its agent |
| `prov:used` | an adjudication used the inventory and the positions |
| `prov:wasDerivedFrom` | the chain link, entry to `prevHash` |
| `prov:atTime` | `at` |

### Build it

- [ ] Write `services/api/provenance.ts` exporting `toProvO(entries: LogEntry[]): object`
      returning JSON-LD with a `@context` pinning the PROV-O namespace.
- [ ] Test against a hand-built three-entry chain, asserting the derivation edges follow
      `prevHash` and that an adjudication carries `prov:used` edges to both its inventory
      and its positions.
- [ ] Serve it beside the existing audit route, as a content negotiation or a
      `?format=prov` parameter, and put it through the same central access check.
- [ ] **Keep the sealing distinction.** A `position_sealed` entry carries only the
      commitment hash, not the position. The PROV-O emission must not dereference it into
      the position content, or the export leaks what the blind protocol protects.

**State the limit in the output.** `store.ts:27-38` already says what the chain does not
prove: it shows a position's content matches what was sealed at submit time, and it does
**not** prove the server never read a position early. Participants trust the operator on
that point. Carry that sentence into the export rather than letting a machine-readable
format imply a stronger guarantee than the human-readable one.

## Part 2: OECD QAF alignment

The four principles and where each already lives:

| QAF principle | where it is today | gap |
|---|---|---|
| Defined endpoint | `EvidenceClaim` carries stream and system | endpoint is implicit in the corpus, not declared per claim |
| Applicability domain | `inApplicabilityDomain` on the claim; R4 discounts on it | P2-A makes it visible; a **conformal** domain with a coverage guarantee does not exist |
| Prediction reliability | Klimisch `1..4`, R5 | not a calibrated probability |
| Fitness for purpose | the context-of-use threshold | present |

The second edition's result-reporting format for **combining multiple predictions** is the
closest external standard to what `fuse.ts` produces, and mapping the fusion output onto it
is the highest-value half of this work.

**Do not claim conformal prediction.** It needs a held-out calibration split and a written
coverage claim. The repository has a calibration split, so it is buildable, and it is its
own task rather than a line item here.

## Part 3: V&V40 as prose

Write `docs/credibility-assessment.md`: the model's influence on the decision, the
consequence of the decision being wrong, the resulting credibility requirement, and the
verification and validation evidence that exists. Most of the content is already true and
merely unwritten: determinism verified by test, a pre-registered hashed ruleset, golden-file
regression gates, and pass marks committed before any model was called.

---

## Definition of done

- [ ] PROV-O export exists, is tested, is access controlled, and does not dereference a
      sealed position.
- [ ] The export carries the same statement of limits the human-readable audit carries.
- [ ] QAF mapping is documented, with the applicability-domain gap named rather than
      papered over.
- [ ] SEND is explicitly listed as unbuilt.

## Traps specific to this task

- **Do not claim SEND support.** No SEND data exists here. Claiming an integration you
  cannot demonstrate is precisely the error this project already corrected once, publicly.
- **Do not let the machine-readable format imply a stronger guarantee** than the prose one.
- **Do not export sealed content.** The commitment is the point.
