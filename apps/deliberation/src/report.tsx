import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ReactElement, type ReactNode,
} from "react";
import { Wordmark } from "@arbiter/design";
import type { CaseReport, Position, ReportPerson } from "./api.js";
import { basisOf } from "./basis.js";
import { QrCode } from "./qr.js";
import { href } from "./router.js";

/**
 * THE RECORD, AS PAGES YOU CAN PRINT.
 *
 * WHY A PAGE AND NOT A DOWNLOAD. This used to hand the reader a finished PDF, built by
 * a headless browser on the server. The document was fine and the shape was wrong: a
 * file that lands in a downloads folder has to be opened before anybody can check it,
 * and by then it has usually already been forwarded. What a person needs first is to
 * SEE the thing they are about to send. So the button opens this, the reader looks, and
 * the export is Chrome's own print dialog, which everybody already knows and which has
 * "Save as PDF" in it.
 *
 * WHY IT IS PAGINATED HERE RATHER THAN LEFT TO THE PRINTER. The first version was one
 * continuous sheet that scrolled, and the browser cut it into pages only at print time.
 * That is a preview that cannot be trusted: the reader has no idea what lands where, a
 * table can be sliced through its middle, and "is this two pages or nine?" is
 * unanswerable until the dialog opens. So the document is measured and laid into real
 * A4 sheets on screen, and the print rules break exactly where these pages break. What
 * you scroll is what comes out, page for page.
 *
 * BREAKS GO BETWEEN BLOCKS, NEVER INSIDE ONE. Each position, table and paragraph is an
 * indivisible unit, so a reviewer's argument is never split across a page boundary and
 * a table never loses its header. That is why the document is built as a flat list of
 * blocks rather than as nested markup: the list IS the set of legal break points.
 *
 * LIGHT ON PAPER, DARK ON SCREEN, one document either way. The sheet used to be light
 * in both places, on the argument that it exists to be printed - which is right about
 * paper and wrong about the screen, where a white page floating in a dark product reads
 * as something that already left the building. The reader checking it has not left yet.
 *
 * The two differ by COLOUR AND NOTHING ELSE. Same blocks, same paginator, same breaks,
 * so "what you scroll is what comes out" survives the change - see the token note in
 * app.css, and the test that keeps it honest.
 *
 * NOTHING HERE IS SUMMARISED, and there is no model on this path. Every position is
 * printed whole, in its author's words, at the same size as every other. A shorter
 * document would be one that chose which dissent to carry.
 *
 * ANY TEAM MEMBER, NOT THE CONVENER. The server resolves a GET to a read, so everyone
 * named on the case reaches this page and prints the same document.
 */

const CALL_LABEL: Record<string, string> = {
  advance: "Advance",
  do_not_advance: "Do not advance",
  cannot_conclude: "Cannot conclude",
};

/** Three positions, three labels, and a fall-through to the raw value rather than a
 *  default: an unrecognised position must look wrong, not look plausible. */
const RULE_POSITION_LABEL: Record<string, string> = {
  applies: "applies",
  does_not_apply: "does not apply",
  cannot_determine: "cannot be determined from this package",
};

const BASIS_NOTE: Record<string, string> = {
  cited: "rests on findings in this case",
  external: "rests on a claim from outside these documents",
  unsupported: "cites nothing from the case documents",
};

/** The consequence call, coloured the way the product colours it. Green, amber and red
 *  mean something specific on a safety document, so an unrecognised verdict gets none. */
function verdictTone(verdict: string): string {
  return verdict === "advance" ? "go" : verdict === "do_not_advance" ? "stop" : verdict === "cannot_conclude" ? "hold" : "";
}

/** A date a person reads. An unparseable value is printed as it is held rather than
 *  rendered as "Invalid Date" - the reader should see the odd value, not a formatter's
 *  opinion of it. */
export function readableDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * What the browser will call the saved file.
 *
 * Chrome takes the default filename in its print dialog from `document.title`, which is
 * the only lever a web page has over it. Named after the compound rather than the case
 * id, because a folder of `case_1174288393.pdf` is a folder nobody can search.
 */
export function reportTitle(r: Pick<CaseReport, "compoundLabel" | "caseId" | "generatedAt">): string {
  const slug = r.compoundLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const day = /^\d{4}-\d{2}-\d{2}/.exec(r.generatedAt)?.[0] ?? "undated";
  return `arbiter-${slug === "" ? r.caseId.replace(/[^a-zA-Z0-9]+/g, "-") : slug}-${day}`;
}

/** Prose, kept as prose. Reviewers write paragraphs, and a record that collapsed them
 *  into one block would change what a careful argument looks like on the page. */
function Prose({ text }: { text: string }): ReactElement {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b !== "");
  return <>{blocks.map((b, i) => <p key={i}>{b}</p>)}</>;
}

function Seat({ seat }: { seat: number | null }): ReactElement | null {
  return seat === null ? null : <span className="rep-seat">{seat + 1}</span>;
}

function Person({ p }: { p: ReportPerson }): ReactElement {
  return (
    <>
      <strong>{p.displayName}</strong>
      {p.email !== "" && <span className="rep-mono rep-tiny"> {p.email}</span>}
    </>
  );
}

/**
 * WHAT THE PANEL DECIDED, in the block a reader looks at first.
 *
 * The signature outranks the adjudication here, and that ordering is §6.7 on the page:
 * a committee advises, one named individual decides, and the signer may override.
 * Printing the model's call as "the decision" would put the adjudication in the place
 * the human occupies, on the artefact most likely to be read by somebody who never saw
 * the difference on screen.
 */
function Decision({ report, nameOf }: { report: CaseReport; nameOf: (id: string) => string }): ReactElement {
  const modelCall = CALL_LABEL[report.adjudication.consequence.verdict] ?? report.adjudication.consequence.verdict;
  const s = report.signature;

  if (s === null) {
    return (
      <>
        <div className="rep-decision">
          <div className="rep-label">The adjudication proposes</div>
          <div className={`rep-call ${verdictTone(report.adjudication.consequence.verdict)}`}>{modelCall}</div>
        </div>
        <div className="rep-unsigned">
          <strong>Nobody has signed this.</strong> The panel has answered and the adjudication
          has run, but no named person has taken the decision - so this records a deliberation
          in progress and not a decision. Everything below is what was said, never what was settled.
        </div>
      </>
    );
  }

  return (
    <div className="rep-decision">
      <div className="rep-label">{s.agreesWithAdjudication ? "Signed" : "Signed - overriding the adjudication"}</div>
      <div className={`rep-call ${s.agreesWithAdjudication ? verdictTone(report.adjudication.consequence.verdict) : ""}`}>
        {s.agreesWithAdjudication ? modelCall : "Overridden"}
      </div>
      <p className="rep-by">
        by <strong>{nameOf(s.by)}</strong> on {readableDate(s.at)}
        {/* The overridden call is still named. A record that hid it would report the
            adjudication's answer as the outcome. */}
        {!s.agreesWithAdjudication && <>, against an adjudication that said <strong>{modelCall}</strong></>}.
      </p>
      {s.reason.trim() !== "" && <div className="rep-note"><Prose text={s.reason} /></div>}
    </div>
  );
}

/* ------------------------------------------------------------------ the blocks */

/**
 * One indivisible piece of the document.
 *
 * The page breaks fall between these and never inside one, so the granularity here is
 * a set of editorial decisions rather than a rendering detail: a position is one block
 * because splitting somebody's argument across a page turns one reviewer into two half
 * ones, and a table is one block because a header row on the previous page is a table
 * nobody can read.
 */
interface Block { key: string; node: ReactNode }

const block = (key: string, node: ReactNode): Block => ({ key, node });

/** A section opener. The heading and its first paragraph travel together, because a
 *  heading alone at the foot of a page belongs to nothing. */
function opener(n: number, title: string, intro?: ReactNode): Block {
  return block(`s${n}`, (
    <div className="rep-section">
      <h2>{n}. {title}</h2>
      {intro}
    </div>
  ));
}

function panelBlocks(report: CaseReport): Block[] {
  const ownerOnPanel = report.panel.some((p) => p.id === report.owner.id);
  return [
    opener(1, "Who answered", (
      <p>
        The convener chooses who answers and signs at the end, and does not answer - so nobody
        both sets the question and votes on it. Every position below was sealed before any of
        them could see another.
      </p>
    )),
    block("s1-table", (
      <table className="rep-table">
        <thead><tr><th>seat</th><th>on the panel</th><th>answered</th></tr></thead>
        <tbody>
          {report.panel.map((p) => (
            <tr key={p.id}>
              <td className="rep-n">{p.seat === null ? "-" : p.seat + 1}</td>
              <td>
                <Person p={p} />
                {p.id === report.owner.id && <span className="rep-tiny rep-muted"> - convener</span>}
              </td>
              <td>
                {report.positions.some((x) => x.participantId === p.id)
                  ? <span className="rep-state present">sealed</span>
                  : <span className="rep-state absent">no answer</span>}
              </td>
            </tr>
          ))}
          {!ownerOnPanel && (
            <tr>
              <td className="rep-n">-</td>
              <td>
                <Person p={report.owner} />
                <span className="rep-tiny rep-muted"> - convener, does not answer</span>
              </td>
              <td><span className="rep-state not_applicable">n/a</span></td>
            </tr>
          )}
        </tbody>
      </table>
    )),
  ];
}

function positionBlocks(report: CaseReport, nameOf: (id: string) => string): Block[] {
  const byId = new Map(report.findings.map((f) => [f.id, f] as const));
  const seatOf = (id: string): number | null => report.panel.find((p) => p.id === id)?.seat ?? null;
  const absent = report.closedEarly?.nonResponders ?? [];
  const out: Block[] = [
    opener(2, "What each person said", (
      <p>
        In full, in their own words, at the same size. Nothing here is summarised and nothing is
        ranked: the order is the order the record holds, which is deliberately not submission
        order - first to answer reads as most confident and last as most considered, and neither
        is information about the compound.
      </p>
    )),
  ];

  if (absent.length > 0) {
    out.push(block("s2-absent", (
      <div className="rep-concern">
        <strong>
          {absent.length === 1 ? "One person on the panel never answered" : `${absent.length} people on the panel never answered`}:
        </strong>{" "}
        {absent.map(nameOf).join(", ")}. The case was closed without them by{" "}
        {nameOf(report.closedEarly?.by ?? "")} on {readableDate(report.closedEarly?.at ?? "")}.
        Their silence is not agreement, and this document counts it as neither.
      </div>
    )));
  }

  for (const p of report.positions as Position[]) {
    out.push(block(`pos-${p.participantId}`, (
      <article className="rep-position">
        <div className="rep-who">
          <Seat seat={seatOf(p.participantId)} />
          <span className="rep-name">{nameOf(p.participantId)}</span>
          <span className="rep-call-chip">{CALL_LABEL[p.call] ?? p.call}</span>
          <span className="rep-basis">{BASIS_NOTE[basisOf(p)] ?? basisOf(p)}</span>
        </div>
        <Prose text={p.reasoning} />

        {p.citedFindingIds.length > 0 && (
          <div className="rep-cites">
            <strong>Relying on:</strong>
            <ul>
              {p.citedFindingIds.map((id) => {
                const f = byId.get(id);
                return f === undefined
                  // Cannot happen through the API - a position citing an unknown finding
                  // is rejected at the door - so if it ever prints, the record and the
                  // findings have diverged and the reader should see that rather than a
                  // silently shortened list.
                  ? <li key={id}><span className="rep-mono">{id}</span> - not among the findings printed below</li>
                  : (
                    <li key={id}>
                      <strong>{f.label}</strong> <span className="rep-tiny">asserts {f.assertion}</span>
                      <div className="rep-tiny">{f.detail}</div>
                    </li>
                  );
              })}
            </ul>
          </div>
        )}

        {p.external.length > 0 && (
          <div className="rep-cites">
            <strong>From outside these documents:</strong>
            <ul>
              {p.external.map((e, i) => (
                <li key={i}>
                  &ldquo;{e.claim}&rdquo;{" "}
                  <span className="rep-tiny">
                    {e.source === undefined || e.source.trim() === ""
                      ? "- no source given, so nothing in this case tests it"
                      : `- ${e.source}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="rep-tiny rep-muted">Sealed {readableDate(p.submittedAt)}</div>
      </article>
    )));
  }

  return out;
}

/** Agreement, and what it is not. §6.6: unanimity beside an unanswered question is a
 *  fact about the record and it is checkable arithmetic - no model produced a line of
 *  this section. */
function agreementBlocks(report: CaseReport, nameOf: (id: string) => string): Block[] {
  const u = report.unanimity;
  const d = report.disagreement;
  const labelOf = (id: string): string => report.findings.find((f) => f.id === id)?.label ?? id;
  const out: Block[] = [opener(3, "Where the panel agreed, and where it split")];

  if (u.unanimous) {
    out.push(block("s3-unanimous", (
      <p>
        Every position on this case was <strong>{CALL_LABEL[u.call ?? ""] ?? String(u.call)}</strong>.
        That is agreement, which is not the same as being right, and nothing below came from a model.
      </p>
    )));
    if (u.concerns.length === 0) {
      out.push(block("s3-clean", <p className="rep-ok">No unanswered questions, and every position rests on cited evidence.</p>));
    } else {
      u.concerns.forEach((c, i) => out.push(block(`s3-concern-${i}`, <div className="rep-concern">{c}</div>)));
    }
    return out;
  }

  if (d === null) {
    out.push(block("s3-thin", <p>Not enough positions to describe agreement or a split.</p>));
    return out;
  }

  out.push(block("s3-intro", (
    <p>
      The panel split. Where it split, and on what evidence, is arithmetic over the positions -
      deliberately not a judgment about who is right, because deciding which reading of a finding
      is correct is the work the adjudication and the signer do.
    </p>
  )));
  out.push(block("s3-split", (
    <table className="rep-table">
      <thead><tr><th>call</th><th>who</th><th className="rep-n">n</th></tr></thead>
      <tbody>
        {d.split.map((s) => (
          <tr key={s.call}>
            <td><strong>{CALL_LABEL[s.call] ?? s.call}</strong></td>
            <td>{s.participantIds.map(nameOf).join(", ")}</td>
            <td className="rep-n">{s.participantIds.length}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )));

  if (d.contested.length > 0) {
    out.push(block("s3-contested", (
      <>
        <h3>The same evidence, read two ways</h3>
        <p className="rep-muted">
          Cited by more than one camp. This is common ground being read differently, and it is
          usually the conversation worth having.
        </p>
        <ul>{d.contested.map((id) => <li key={id}>{labelOf(id)}</li>)}</ul>
      </>
    )));
  }

  if (d.oneSided.length > 0) {
    out.push(block("s3-onesided", (
      <>
        <h3>Cited by one side only</h3>
        <p className="rep-muted">Evidence the other camp did not answer.</p>
        <ul>
          {d.oneSided.map((o) => (
            <li key={o.findingId}>
              {labelOf(o.findingId)}{" "}
              <span className="rep-tiny">- cited only by those who said {CALL_LABEL[o.call] ?? o.call}</span>
            </li>
          ))}
        </ul>
      </>
    )));
  }

  return out;
}

function adjudicationBlocks(report: CaseReport): Block[] {
  const a = report.adjudication;
  const labelOf = (id: string): string => report.findings.find((f) => f.id === id)?.label ?? id;
  const cites = (ids: string[]): ReactElement => (
    <div className="rep-tiny rep-muted">
      {ids.length === 0 ? "Cites no finding." : `Cites: ${ids.map(labelOf).join("; ")}`}
    </div>
  );

  const out: Block[] = [
    opener(4, "The adjudication", (
      <p className="rep-muted">
        Produced by a model, after the reveal and never before, reading the positions above and the
        evidence below. It advises. It decided nothing: the decision is at the top of this document
        and it carries a person&rsquo;s name.
      </p>
    )),
    block("s4-mechanism", (
      <>
        <h3>Mechanism - is there a route to liver injury?</h3>
        <p><strong>{a.mechanism.present ? "Present." : "Not established."}</strong> {a.mechanism.pathway}</p>
        {cites(a.mechanism.citedFindingIds)}
      </>
    )),
    block("s4-consequence", (
      <>
        <h3>Consequence - is it severe enough to stop?</h3>
        <p>
          <strong className={verdictTone(a.consequence.verdict)}>
            {CALL_LABEL[a.consequence.verdict] ?? a.consequence.verdict}
          </strong>
        </p>
        <Prose text={a.consequence.reasoning} />
        {cites(a.consequence.citedFindingIds)}
      </>
    )),
    block("s4-rules-head", (
      <>
        <h3>Every rule, answered</h3>
        <p className="rep-muted">
          One line per registered rule, including the rules that did not apply. A rule nobody could
          answer is reported as such rather than as a rule answered in the negative.
        </p>
      </>
    )),
    block("s4-rules", (
      <table className="rep-table">
        <thead><tr><th>rule</th><th>position</th><th>why</th></tr></thead>
        <tbody>
          {a.ruleDisclosure.map((r) => (
            <tr key={r.ruleId}>
              <td className="rep-mono">{r.ruleId}</td>
              <td>{RULE_POSITION_LABEL[r.position] ?? r.position}</td>
              <td>
                {r.reasoning}
                {r.citedFindingIds.length > 0 && (
                  <div className="rep-tiny rep-muted">{r.citedFindingIds.map(labelOf).join("; ")}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )),
  ];

  if (a.missing.length > 0) {
    out.push(block("s4-missing", (
      <>
        <h3>Still unanswered</h3>
        <table className="rep-table">
          <thead><tr><th>question</th><th>why it matters</th></tr></thead>
          <tbody>
            {a.missing.map((m, i) => <tr key={i}><td>{m.field}</td><td>{m.whyItMatters}</td></tr>)}
          </tbody>
        </table>
      </>
    )));
  }

  if (a.nextExperiment !== null) {
    out.push(block("s4-next", (
      <>
        <h3>What would settle it</h3>
        <Prose text={a.nextExperiment} />
      </>
    )));
  }

  return out;
}

function evidenceBlocks(report: CaseReport): Block[] {
  const inv = report.inventory;
  const absent = inv.entries.filter((e) => e.state === "absent").length;
  const inconclusive = inv.entries.filter((e) => e.state === "inconclusive").length;
  const na = inv.entries.filter((e) => e.state === "not_applicable").length;

  return [
    opener(5, "The evidence this was decided on", (
      <p>
        Checklist v{inv.checklistVersion} against a {inv.modality.replace("_", " ")}. {absent} of{" "}
        {inv.entries.length} questions unanswered
        {inconclusive > 0 && `, ${inconclusive} tested and unresolved`}
        {na > 0 && `, ${na} that ${na === 1 ? "does" : "do"} not arise for this modality and ${na === 1 ? "is" : "are"} marked n/a rather than missing`}.
        Ordered by checklist id and by nothing else - ordering gaps by importance would rank them,
        and nothing in this system ranks a gap.
      </p>
    )),
    block("s5-inventory", (
      <table className="rep-table">
        <thead><tr><th>id</th><th>state</th><th>question</th><th>what it blocks</th></tr></thead>
        <tbody>
          {inv.entries.map((e) => (
            <tr key={e.itemId}>
              <td className="rep-mono">{e.itemId}</td>
              <td><span className={`rep-state ${e.state}`}>{e.state === "not_applicable" ? "n/a" : e.state}</span></td>
              <td>
                {e.field}
                {e.findingIds.length > 0 && <div className="rep-mono rep-tiny rep-muted">{e.findingIds.join(", ")}</div>}
              </td>
              <td className="rep-tiny">
                {e.state === "not_applicable"
                  ? (e.whyNotApplicable ?? "Does not apply to this kind of drug.")
                  : e.whatItBlocks}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )),
    block("s5-findings", (
      <>
        <h3>The findings the panel answered against</h3>
        {report.findings.length === 0
          ? <p className="rep-bad">This case holds no findings at all. Every position on it was reached against an empty inventory.</p>
          : (
            <table className="rep-table">
              <thead><tr><th>asserts</th><th>what was measured</th><th>what it said</th><th>source</th></tr></thead>
              <tbody>
                {report.findings.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <span className={`rep-state ${f.assertion === "toxic" ? "absent" : f.assertion === "safe" ? "present" : "inconclusive"}`}>
                        {f.assertion}
                      </span>
                    </td>
                    <td><strong>{f.label}</strong><div className="rep-mono rep-tiny rep-muted">{f.id}</div></td>
                    <td>
                      {f.detail}
                      {f.sourceQuote !== undefined && <div className="rep-tiny">&ldquo;{f.sourceQuote}&rdquo;</div>}
                    </td>
                    <td className="rep-tiny">
                      {f.sourceDocument === undefined && f.sourcePage === undefined
                        ? <span className="rep-muted">not anchored</span>
                        : <>{f.sourceDocument ?? "uploaded document"}{f.sourcePage !== undefined && <div>p. {f.sourcePage}</div>}</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </>
    )),
  ];
}

function recordBlocks(report: CaseReport): Block[] {
  const a = report.audit;
  const clean = a.chainFailures === 0 && a.sealFailures === 0;
  return [
    opener(6, "The record", (
      <p className={clean ? "rep-ok" : "rep-bad"}>
        {clean
          ? "Chain intact, and every revealed position matches the commitment written while the case was blind."
          : `TAMPERING DETECTED: ${a.chainFailures} chain failure${a.chainFailures === 1 ? "" : "s"}, ${a.sealFailures} seal failure${a.sealFailures === 1 ? "" : "s"}. Do not rely on this document; go and read the log.`}
      </p>
    )),
    block("s6-proves", (
      <p>
        What that proves: no position was edited after it was sealed - the commitment hash is written
        to the log while the case is still open and before anything is revealed, so the plaintext
        published at reveal must hash to it. What it does not prove: that the server never read a
        position early. No server-side scheme can, and claiming otherwise would be the more dangerous
        error.
      </p>
    )),
    block("s6-meta", (
      <div className="rep-meta">
        <div><span>case</span>{report.caseId}</div>
        <div><span>entries in the log</span>{a.entries}</div>
        <div><span>head hash</span>{a.headHash ?? "none"}</div>
        <div><span>chain failures</span>{a.chainFailures}</div>
        <div><span>seal failures</span>{a.sealFailures}</div>
      </div>
    )),
    block("s6-note", (
      <div className="rep-note">
        <strong>A printed copy carries no chain.</strong> Paper and PDF can both be edited by anybody
        holding them, and neither carries a signature over its own bytes. What makes this checkable is
        that it names the case and the head hash above: a reader who doubts the copy can open the
        record it was printed from and compare.
      </div>
    )),
  ];
}

function documentBlocks(report: CaseReport, nameOf: (id: string) => string, url: string | null): Block[] {
  const answered = report.positions.length;
  const out: Block[] = [
    block("masthead", (
      <header className="rep-masthead">
        <Wordmark className="rep-wordmark" />
        <span className="rep-kind">Deliberation record</span>
      </header>
    )),
    block("title", (
      <>
        <h1 className="rep-title">{report.compoundLabel}</h1>
        {report.context.trim() !== "" && <p className="rep-context">{report.context}</p>}
      </>
    )),
    ...(report.adjudicationSource === "stub" ? [block("stub", (
      <div className="rep-stub">
        <strong>STUB - NO MODEL WAS CALLED.</strong>
        The adjudication in this document was produced by a placeholder, not by a model reading
        this case. The wiring is real; the words are not a judgment about this compound and must
        not be quoted as one. Everything the panel said is genuine; everything attributed to the
        adjudication is not.
      </div>
    ))] : []),
    block("decision", <Decision report={report} nameOf={nameOf} />),
  ];

  /* IMMEDIATELY AFTER THE DECISION, ON THE FIRST SHEET, so a sheet of paper on a desk
     leads back to the live record without anybody having to turn a page to find it.
     It is a Block like any other, so the paginator keeps the code and its caption
     together for free - no extra rule needed to stop it splitting across a break.
     Absent whenever there is no URL, which is what keeps a never-published record
     from printing a QR that leads nowhere. */
  if (url !== null) {
    out.push(block("qr", (
      <div className="rep-qr-block">
        <QrCode value={url} size={132} />
        <div>
          <div className="rep-label">The live record</div>
          <p className="rep-tiny">
            This document is a snapshot. Scan for the record as it stands now, including
            anything signed after this was printed.
          </p>
          <p className="rep-mono rep-tiny">{url}</p>
        </div>
      </div>
    )));
  }

  out.push(
    block("meta", (
      <div className="rep-meta">
        <div><span>case</span>{report.caseId}</div>
        <div><span>status</span>{report.status}</div>
        <div><span>convened by</span>{report.owner.displayName}</div>
        <div><span>panel</span>{report.panel.length} named, {answered} answered</div>
        <div>
          <span>adjudicated</span>
          {report.adjudicatedAt === null ? "-" : readableDate(report.adjudicatedAt)}
          {report.adjudicationSource === "stub" ? " (STUB - no model)" : " (model)"}
        </div>
        <div><span>generated</span>{readableDate(report.generatedAt)} by {report.generatedBy.displayName}</div>
      </div>
    )),
    ...panelBlocks(report),
    ...positionBlocks(report, nameOf),
    ...agreementBlocks(report, nameOf),
    ...adjudicationBlocks(report),
    ...evidenceBlocks(report),
    ...recordBlocks(report),
  );

  return out;
}

/* --------------------------------------------------------------- the paginator */

/**
 * Lay the blocks onto sheets.
 *
 * HOW IT DECIDES WHERE A PAGE ENDS. Everything is rendered once into a hidden column
 * the exact width of a page's text area, each block's height is read from the browser,
 * and blocks are packed onto a sheet until the next one would not fit. No block is ever
 * cut. The height of a page's text area is measured from a probe element sized in
 * millimetres rather than computed from an assumed DPI - the browser knows what a
 * millimetre is on this display and this file does not.
 *
 * WHY THE MEASUREMENT PASS IS THROWN AWAY. Once the pages exist the hidden column is
 * removed, so the document appears in the DOM exactly once. Rendering both would double
 * every sentence for a screen reader and for anything that searches the page.
 *
 * WHEN THE MEASUREMENT SAYS NOTHING - no layout engine, as in a test environment -
 * every height reads zero, everything lands on one sheet, and the document is still
 * complete and in order. Degrading to one long page is the correct failure: it is what
 * this looked like before, and it loses nothing but the page breaks.
 */
function Paginate({ blocks, foot, at, toSheet, onNavigate }: {
  blocks: Block[];
  foot: (page: number, of: number) => ReactNode;
  /** Which sheet is on screen. Clamped below - a stale link to sheet 9 of a document
   *  that is now 7 sheets long should land on the last one, not on nothing. */
  at: number;
  toSheet: (n: number) => string;
  /** Turns the pager from links into buttons, for a caller with no route to hold the
   *  sheet number in. See the comment on the `<nav>` below for which caller that is
   *  and why. */
  onNavigate?: (n: number) => void;
}): ReactElement {
  const column = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const probeFoot = useRef<HTMLElement>(null);
  const [pages, setPages] = useState<Block[][] | null>(null);

  useLayoutEffect(() => {
    setPages(null);
  }, [blocks]);

  useLayoutEffect(() => {
    if (pages !== null) return;
    const host = column.current;
    const gauge = probe.current;
    if (host === null || gauge === null) return;

    /* WHAT A BLOCK ACTUALLY HAS ROOM FOR. The gauge is one page's text area; the
       running footer sits inside that area on every sheet, so it comes off the budget.
       Leaving it in was worth an extra printed page per sheet: the content filled the
       text area exactly, the footer went past the bottom, and the printer put it on a
       page of its own - nine pages for five sheets. */
    const footer = probeFoot.current?.getBoundingClientRect().height ?? 0;
    // A few pixels of slack, because the print box is derived from @page and can round
    // a hair differently from a gauge measured in the layout viewport. Overshooting a
    // page costs a whole extra sheet; undershooting costs a few millimetres of white.
    const usable = gauge.getBoundingClientRect().height - footer - 8;

    const laid: Block[][] = [];
    let current: Block[] = [];
    let filled = 0;

    [...host.children].forEach((child, i) => {
      const el = child as HTMLElement;
      const style = window.getComputedStyle(el);
      const height = el.getBoundingClientRect().height
        + (Number.parseFloat(style.marginTop) || 0)
        + (Number.parseFloat(style.marginBottom) || 0);
      // A block taller than a whole page cannot be made to fit, and slicing it is the
      // one thing this is here to prevent - so it takes a sheet of its own and is
      // allowed to run over it rather than being cut.
      if (current.length > 0 && usable > 0 && filled + height > usable) {
        laid.push(current);
        current = [];
        filled = 0;
      }
      current.push(blocks[i]!);
      filled += height;
    });
    if (current.length > 0) laid.push(current);
    setPages(laid.length === 0 ? [[]] : laid);
  }, [pages, blocks]);

  if (pages === null) {
    return (
      <div className="report-doc rep-measuring" aria-hidden="true">
        <div ref={probe} className="rep-gauge" />
        <div ref={column} className="rep-column">
          {blocks.map((b) => <div className="rep-block" key={b.key}>{b.node}</div>)}
        </div>
        {/* Measured, not assumed: the footer is type, and type reflows. */}
        <footer ref={probeFoot} className="rep-page-foot">{foot(1, 1)}</footer>
      </div>
    );
  }

  // The same clamp the reader applies to a page number out of a document's range.
  const current = Math.min(Math.max(at, 1), pages.length);

  return (
    /* THE PAGER BELONGS TO THE PRODUCT, THE SHEET TO THE DOCUMENT, and they must not
       share an ink. Inside `.report-doc` the controls inherited the document's near
       black - correct on paper, invisible on the app's dark ground, which took
       "Previous" and "Sheet 1 of 7" off the screen entirely and left a lone Next
       floating above the page. So the viewer is the app's box, `.report-doc` is the
       paper inside it, and the boundary between them is where the palette changes. */
    <div className="rep-view">
      {/*
        ONE SHEET AT A TIME, TURNED WITH A CONTROL - the reading room's arrangement,
        because it is the same act: reading a document inside a product rather than
        scrolling a web page. Stacking every sheet made the length of the record the
        first thing about it and buried the decision, which is on sheet one.

        Links through the hash, not buttons over local state, for the reason the
        reader's pager gives: the route already carries the sheet, and that is what
        makes it shareable, bookmarkable and reachable with the back button. That
        reasoning needs a route to parse the hash into a page number, which is exactly
        what the public entry does not have - `public.tsx` imports no router at all,
        deliberately, so a link that only ever changed `location.hash` would sit there
        looking clickable and turning no page. `onNavigate`, when the caller supplies
        it, swaps the link for a button and the hash for a state setter the caller owns;
        omitted, the pager is exactly what it always was.

        ABOVE THE SHEET. An A4 page is taller than most windows, so a pager underneath
        sits a full sheet past the fold - turning to sheet 2 of 7 would mean scrolling
        to the bottom of sheet 1 first, every time.
      */}
      {pages.length > 1 && (
        <nav className="pager no-print" aria-label="Sheets of the record">
          {current > 1
            ? (onNavigate === undefined
                ? <a className="ghost" rel="prev" href={toSheet(current - 1)}>Previous</a>
                : <button className="ghost" onClick={() => { onNavigate(current - 1); }}>Previous</button>)
            : <span className="ghost off">Previous</span>}
          <span className="at">Sheet {current} of {pages.length}</span>
          {current < pages.length
            ? (onNavigate === undefined
                ? <a className="ghost" rel="next" href={toSheet(current + 1)}>Next</a>
                : <button className="ghost" onClick={() => { onNavigate(current + 1); }}>Next</button>)
            : <span className="ghost off">Next</span>}
        </nav>
      )}

      {/*
        EVERY SHEET STAYS IN THE DOCUMENT; only one is shown. Unmounting the others
        would mean printing whatever happened to be on screen - a one-page PDF of sheet
        4 - and the print rules put them all back. It also keeps find-on-page working
        across the whole record.
      */}
      <div className="report-doc">
        {pages.map((page, i) => (
          <section
            className={`rep-page${i + 1 === current ? "" : " rep-page--off"}`}
            key={i}
            aria-label={`Sheet ${i + 1} of ${pages.length}`}
            aria-hidden={i + 1 === current ? undefined : true}
          >
            <div className="rep-page-body">
              {page.map((b) => <div className="rep-block" key={b.key}>{b.node}</div>)}
            </div>
            <footer className="rep-page-foot">{foot(i + 1, pages.length)}</footer>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * The preview, and the control that prints it.
 *
 * The print bar is `no-print`, so what comes out of the dialog is the sheets and
 * nothing else - no app chrome, and no button reading "print" printed onto the page it
 * printed.
 */
export function ReportPage({ report, page, share, publishedUrl, onNavigate }: {
  report: CaseReport;
  page?: number;
  /** The convener's controls. Absent on the public page - which is what removes them
   *  there, rather than a flag the public entry has to remember to pass. */
  share?: { url: string | null; onPublish: () => void; onRevoke: () => void };
  /** The published URL when there are no controls to go with it: the public page draws
   *  the same QR the convener printed, so a scanned page and a shared link agree. */
  publishedUrl?: string;
  /** Passed straight to `Paginate`. See its own doc comment - this is how the public
   *  page turns sheets with no router to carry the page number in the URL. */
  onNavigate?: (n: number) => void;
}): ReactElement {
  const nameOf = (id: string): string =>
    report.panel.concat(report.owner).find((p) => p.id === id)?.displayName ?? id;

  // `share`, when present, is the more current answer - it comes from state this page
  // itself keeps in sync with a publish or revoke; `publishedUrl` is what the public
  // page passes instead, since it never has controls to hold a `share` object at all.
  const url = share?.url ?? publishedUrl ?? null;

  // Stable across renders, because it is what the paginator re-measures on.
  const blocks = useMemo(() => documentBlocks(report, nameOf, url), [report, url]);

  /* THE TAB TITLE IS THE FILENAME. Chrome proposes `document.title` as the name in its
     save dialog, which is the only influence a page has over it - so the tab carries
     the document's name while this page is open, and the previous title is put back on
     the way out rather than left behind on whatever screen comes next. */
  useEffect(() => {
    const previous = document.title;
    document.title = reportTitle(report);
    return () => { document.title = previous; };
  }, [report]);

  return (
    <div className="rep-wrap">
      <div className="rep-bar no-print">
        {/* WRITTEN FOR THE CONVENER, NOT FOR WHOEVER HOLDS THE LINK. "The record, ready
            to print" and "Back to the verdict" both address someone running this case -
            the second is a link INTO the signed-in app, which is exactly the surface a
            stranger reading a QR code must never be one click from. `share !== undefined`
            is the same signal the publish/revoke section below already keys off, so
            there is one rule for "is this the convener's own page", not two. */}
        {share !== undefined && (
          <div>
            <h1>The record, ready to print</h1>
            <p className="muted">
              The whole case as one document: the decision, every position in full, the adjudication,
              the evidence it was decided on and the state of the chain. What you see below is what
              prints - page for page. Choose <strong>Save as PDF</strong> as the destination to keep a copy.
            </p>
          </div>
        )}
        <div className="btn-row">
          <button className="primary" onClick={() => { window.print(); }}>Print or save as PDF</button>
          {share !== undefined && (
            <a href={href({ name: "reveal", caseId: report.caseId })}>
              <button className="ghost">Back to the verdict</button>
            </a>
          )}
        </div>
      </div>

      <Paginate
        blocks={blocks}
        at={page ?? 1}
        toSheet={(n) => href({ name: "report", caseId: report.caseId, page: n })}
        {...(onNavigate === undefined ? {} : { onNavigate })}
        foot={(sheet, of) => (
          <>
            <span>ARBITER · {report.compoundLabel} · {report.caseId}</span>
            <span>{sheet} of {of}</span>
          </>
        )}
      />

      {/* THE CONVENER'S CONTROL, not the document's. `no-print` for the same reason as
          the bar above: a button printed onto the record is the tell of a page that
          never had a print stylesheet. `share === undefined` is how the public page -
          which has no owner and no route to these three calls - renders no control at
          all rather than one it would 403 the moment it was used. */}
      {share !== undefined && (
        <section className="rep-share no-print">
          {share.url === null
            ? <>
                <p>Publish this record to a link anyone can open, and print a QR code for it onto the document.</p>
                <button className="primary" onClick={share.onPublish}>Publish this record</button>
              </>
            : <>
                <p className="rep-mono">{share.url}</p>
                <p className="small muted">
                  Anyone holding this link can read the record, without an account. Revoking it
                  stops the link - it cannot reach a copy already printed or saved.
                </p>
                <button className="ghost" onClick={share.onRevoke}>Revoke this link</button>
              </>}
        </section>
      )}
    </div>
  );
}
