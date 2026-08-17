import { useEffect, type ReactElement, type ReactNode } from "react";
import { Wordmark } from "@arbiter/design";
import type { CaseReport, Position, ReportPerson } from "./api.js";
import { basisOf } from "./screens.js";
import { href } from "./router.js";

/**
 * THE RECORD, AS A PAGE YOU CAN PRINT.
 *
 * WHY A PAGE AND NOT A DOWNLOAD. This used to hand the reader a finished PDF, built by
 * a headless browser on the server. The document was fine and the shape was wrong: a
 * file that lands in a downloads folder has to be opened before anybody can check it,
 * and by then it has usually already been forwarded. What a person actually needs
 * first is to SEE the thing they are about to send - the whole point of a record that
 * carries the dissent is that somebody reads it. So the button opens this, the reader
 * looks, and the export is Chrome's own print dialog, which every reader already knows
 * and which has "Save as PDF" in it.
 *
 * IT ALSO DELETED A DEPENDENCY. The old path needed a Chromium binary installed beside
 * the API and a second stylesheet that imitated the product without being able to use
 * any of it. This page is drawn with the app's own design system and the real wordmark
 * from `@arbiter/design` - so it cannot drift from the product the way a copy would.
 *
 * NOTHING HERE IS SUMMARISED, and there is no model on this path. Every position is
 * printed whole, in its author's words, at the same size as every other. A shorter
 * document would be one that chose which dissent to carry.
 *
 * ANY TEAM MEMBER, NOT THE CONVENER. The server resolves a GET to a read, so everyone
 * named on the case reaches this page and prints the same document. The people who
 * most need to send a record are the ones who cannot show anybody the screen.
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

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }): ReactElement {
  return (
    <section className="rep-section">
      <h2>{n}. {title}</h2>
      {children}
    </section>
  );
}

function Positions({ report, nameOf }: { report: CaseReport; nameOf: (id: string) => string }): ReactElement {
  const byId = new Map(report.findings.map((f) => [f.id, f] as const));
  const seatOf = (id: string): number | null => report.panel.find((p) => p.id === id)?.seat ?? null;
  const absent = report.closedEarly?.nonResponders ?? [];

  return (
    <>
      {absent.length > 0 && (
        <div className="rep-concern">
          <strong>
            {absent.length === 1 ? "One person on the panel never answered" : `${absent.length} people on the panel never answered`}:
          </strong>{" "}
          {absent.map(nameOf).join(", ")}. The case was closed without them by{" "}
          {nameOf(report.closedEarly?.by ?? "")} on {readableDate(report.closedEarly?.at ?? "")}.
          Their silence is not agreement, and this document counts it as neither.
        </div>
      )}

      {report.positions.map((p: Position) => (
        <article className="rep-position" key={p.participantId}>
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
                    // Cannot happen through the API - a position citing an unknown
                    // finding is rejected at the door - so if it ever prints, the
                    // record and the findings have diverged and the reader should see
                    // that rather than a silently shortened list.
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
      ))}
    </>
  );
}

/** Agreement, and what it is not. §6.6: unanimity beside an unanswered question is a
 *  fact about the record and it is checkable arithmetic - no model produced a line of
 *  this section. */
function Agreement({ report, nameOf }: { report: CaseReport; nameOf: (id: string) => string }): ReactElement {
  const u = report.unanimity;
  const d = report.disagreement;
  const labelOf = (id: string): string => report.findings.find((f) => f.id === id)?.label ?? id;

  if (u.unanimous) {
    return (
      <>
        <p>
          Every position on this case was <strong>{CALL_LABEL[u.call ?? ""] ?? String(u.call)}</strong>.
          That is agreement, which is not the same as being right, and nothing below came from a model.
        </p>
        {u.concerns.length === 0
          ? <p className="rep-ok">No unanswered questions, and every position rests on cited evidence.</p>
          : u.concerns.map((c, i) => <div className="rep-concern" key={i}>{c}</div>)}
      </>
    );
  }

  if (d === null) return <p>Not enough positions to describe agreement or a split.</p>;

  return (
    <>
      <p>
        The panel split. Where it split, and on what evidence, is arithmetic over the positions -
        deliberately not a judgment about who is right, because deciding which reading of a finding
        is correct is the work the adjudication and the signer do.
      </p>
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

      {d.contested.length > 0 && (
        <>
          <h3>The same evidence, read two ways</h3>
          <p className="rep-muted">
            Cited by more than one camp. This is common ground being read differently, and it is
            usually the conversation worth having.
          </p>
          <ul>{d.contested.map((id) => <li key={id}>{labelOf(id)}</li>)}</ul>
        </>
      )}

      {d.oneSided.length > 0 && (
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
      )}
    </>
  );
}

function Adjudication({ report }: { report: CaseReport }): ReactElement {
  const a = report.adjudication;
  const labelOf = (id: string): string => report.findings.find((f) => f.id === id)?.label ?? id;
  const Cites = ({ ids }: { ids: string[] }): ReactElement => (
    <div className="rep-tiny rep-muted">
      {ids.length === 0 ? "Cites no finding." : `Cites: ${ids.map(labelOf).join("; ")}`}
    </div>
  );

  return (
    <>
      <p className="rep-muted">
        Produced by a model, after the reveal and never before, reading the positions above and the
        evidence below. It advises. It decided nothing: the decision is at the top of this document
        and it carries a person&rsquo;s name.
      </p>

      <h3>Mechanism - is there a route to liver injury?</h3>
      <p><strong>{a.mechanism.present ? "Present." : "Not established."}</strong> {a.mechanism.pathway}</p>
      <Cites ids={a.mechanism.citedFindingIds} />

      <h3>Consequence - is it severe enough to stop?</h3>
      <p>
        <strong className={verdictTone(a.consequence.verdict)}>
          {CALL_LABEL[a.consequence.verdict] ?? a.consequence.verdict}
        </strong>
      </p>
      <Prose text={a.consequence.reasoning} />
      <Cites ids={a.consequence.citedFindingIds} />

      <h3>Every rule, answered</h3>
      <p className="rep-muted">
        One line per registered rule, including the rules that did not apply. A rule nobody could
        answer is reported as such rather than as a rule answered in the negative.
      </p>
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

      {a.missing.length > 0 && (
        <>
          <h3>Still unanswered</h3>
          <table className="rep-table">
            <thead><tr><th>question</th><th>why it matters</th></tr></thead>
            <tbody>
              {a.missing.map((m, i) => <tr key={i}><td>{m.field}</td><td>{m.whyItMatters}</td></tr>)}
            </tbody>
          </table>
        </>
      )}

      {a.nextExperiment !== null && (
        <>
          <h3>What would settle it</h3>
          <Prose text={a.nextExperiment} />
        </>
      )}
    </>
  );
}

function Evidence({ report }: { report: CaseReport }): ReactElement {
  const inv = report.inventory;
  const absent = inv.entries.filter((e) => e.state === "absent").length;
  const inconclusive = inv.entries.filter((e) => e.state === "inconclusive").length;
  const na = inv.entries.filter((e) => e.state === "not_applicable").length;

  return (
    <>
      <p>
        Checklist v{inv.checklistVersion} against a {inv.modality.replace("_", " ")}. {absent} of{" "}
        {inv.entries.length} questions unanswered
        {inconclusive > 0 && `, ${inconclusive} tested and unresolved`}
        {na > 0 && `, ${na} that ${na === 1 ? "does" : "do"} not arise for this modality and ${na === 1 ? "is" : "are"} marked n/a rather than missing`}.
        Ordered by checklist id and by nothing else - ordering gaps by importance would rank them,
        and nothing in this system ranks a gap.
      </p>

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
  );
}

function Record({ report }: { report: CaseReport }): ReactElement {
  const a = report.audit;
  const clean = a.chainFailures === 0 && a.sealFailures === 0;
  return (
    <>
      <p className={clean ? "rep-ok" : "rep-bad"}>
        {clean
          ? "Chain intact, and every revealed position matches the commitment written while the case was blind."
          : `TAMPERING DETECTED: ${a.chainFailures} chain failure${a.chainFailures === 1 ? "" : "s"}, ${a.sealFailures} seal failure${a.sealFailures === 1 ? "" : "s"}. Do not rely on this document; go and read the log.`}
      </p>
      <p>
        What that proves: no position was edited after it was sealed - the commitment hash is written
        to the log while the case is still open and before anything is revealed, so the plaintext
        published at reveal must hash to it. What it does not prove: that the server never read a
        position early. No server-side scheme can, and claiming otherwise would be the more dangerous
        error.
      </p>
      <div className="rep-meta">
        <div><span>case</span>{report.caseId}</div>
        <div><span>entries in the log</span>{a.entries}</div>
        <div><span>head hash</span>{a.headHash ?? "none"}</div>
        <div><span>chain failures</span>{a.chainFailures}</div>
        <div><span>seal failures</span>{a.sealFailures}</div>
      </div>
      <div className="rep-note">
        <strong>A printed copy carries no chain.</strong> Paper and PDF can both be edited by anybody
        holding them, and neither carries a signature over its own bytes. What makes this checkable is
        that it names the case and the head hash above: a reader who doubts the copy can open the
        record it was printed from and compare.
      </div>
    </>
  );
}

/**
 * The preview, and the control that prints it.
 *
 * The print bar is `rep-bar` and is marked no-print, so what comes out of the dialog is
 * the sheet and nothing else - no app chrome, no button that says "print" printed onto
 * the page it printed.
 */
export function ReportPage({ report }: { report: CaseReport }): ReactElement {
  const nameOf = (id: string): string =>
    report.panel.concat(report.owner).find((p) => p.id === id)?.displayName ?? id;
  const answered = report.positions.length;
  const ownerOnPanel = report.panel.some((p) => p.id === report.owner.id);

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
        <div>
          <h1>The record, ready to print</h1>
          <p className="muted">
            This is the whole case as one document: the decision, every position in full, the
            adjudication, the evidence it was decided on and the state of the chain. Print it, or
            choose <strong>Save as PDF</strong> as the destination to keep a copy.
          </p>
        </div>
        <div className="btn-row">
          <button className="primary" onClick={() => { window.print(); }}>Print or save as PDF</button>
          <a href={href({ name: "reveal", caseId: report.caseId })}>
            <button className="ghost">Back to the verdict</button>
          </a>
        </div>
      </div>

      <article className="report-sheet">
        <header className="rep-masthead">
          <Wordmark className="rep-wordmark" />
          <span className="rep-kind">Deliberation record</span>
        </header>

        <h1 className="rep-title">{report.compoundLabel}</h1>
        {report.context.trim() !== "" && <p className="rep-context">{report.context}</p>}

        {report.adjudicationSource === "stub" && (
          <div className="rep-stub">
            <strong>STUB - NO MODEL WAS CALLED.</strong>
            The adjudication in this document was produced by a placeholder, not by a model reading
            this case. The wiring is real; the words are not a judgment about this compound and must
            not be quoted as one. Everything the panel said is genuine; everything attributed to the
            adjudication is not.
          </div>
        )}

        <Decision report={report} nameOf={nameOf} />

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

        <Section n={1} title="Who answered">
          <p>
            The convener chooses who answers and signs at the end, and does not answer - so nobody
            both sets the question and votes on it. Every position below was sealed before any of
            them could see another.
          </p>
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
        </Section>

        <Section n={2} title="What each person said">
          <p>
            In full, in their own words, at the same size. Nothing here is summarised and nothing is
            ranked: the order is the order the record holds, which is deliberately not submission
            order - first to answer reads as most confident and last as most considered, and neither
            is information about the compound.
          </p>
          <Positions report={report} nameOf={nameOf} />
        </Section>

        <Section n={3} title="Where the panel agreed, and where it split">
          <Agreement report={report} nameOf={nameOf} />
        </Section>

        <Section n={4} title="The adjudication">
          <Adjudication report={report} />
        </Section>

        <Section n={5} title="The evidence this was decided on">
          <Evidence report={report} />
        </Section>

        <Section n={6} title="The record">
          <Record report={report} />
        </Section>

        <footer className="rep-foot">
          ARBITER · {report.compoundLabel} · {report.caseId}
        </footer>
      </article>
    </div>
  );
}
