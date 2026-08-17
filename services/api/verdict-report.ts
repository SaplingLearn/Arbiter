import type { Adjudication, Finding } from "./adjudicate.js";
import {
  positionBasis,
  type CaseStatus, type DisagreementReport, type Position, type Signature, type UnanimityReport,
} from "./deliberation.js";
import type { Inventory } from "./inventory.js";

/**
 * The deliberation record, as one document a person can hand to somebody who was not
 * in the room.
 *
 * WHY THIS EXISTS. Everything this product knows about a closed case lives on four
 * screens behind an authenticated session: the positions on the reveal, the
 * adjudication on the verdict tab, the gaps on the evidence stage, the chain on the
 * record. The people who have to READ a safety decision - a programme lead, a
 * regulator, the person who inherits the compound in two years - do not have a session
 * and are not going to click four tabs. Until this file existed the honest answer to
 * "send me what the panel concluded" was a screenshot, and a screenshot is exactly the
 * artefact this project spends its whole design budget trying not to produce: it
 * carries the verdict, drops the dissent, and cannot be checked against anything.
 *
 * EVERY FIGURE IS READ FROM THE RECORD. Not one sentence of judgment is written here.
 * The same discipline `report.ts` states for the evaluation PDF: this file lays out
 * what the log holds and refuses when the log does not hold it, because a document
 * that renders a hole is worse than one that will not render, and only the second is
 * noticed.
 *
 * NOTHING IS SUMMARISED. There is no model call on this path and there must never be
 * one. A model that condensed four positions into a paragraph would be deciding which
 * dissent is worth carrying, on the one artefact that leaves the building - and it
 * would do it in the same fluent voice as the adjudication it sits beside, so a reader
 * could not tell the record from the retelling. Everybody's reasoning is printed
 * whole, in their own words, at the same size.
 *
 * IT IS NOT A CERTIFICATE. It is a print of a record, and it says so: a PDF carries no
 * chain, so it can be edited by anyone holding it. What makes it checkable is that it
 * names the case, the head hash and the audit result, so a reader who doubts the paper
 * can go and verify the log it was printed from.
 */

/** One person, as this document names them. The seat is what colours them on screen,
 *  and it is printed so a reader holding both can match a paragraph to a badge. */
export interface ReportPerson {
  id: string;
  displayName: string;
  email: string;
  seat: number | null;
}

export interface ReportInput {
  caseId: string;
  compoundLabel: string;
  context: string;
  status: CaseStatus;
  owner: ReportPerson;
  /** Everyone named on the case, in seat order. */
  panel: ReportPerson[];
  /** As revealed. Sorted by the service, and this file does not re-sort them: the
   *  order positions arrive in is deliberately not submission order (§6.2), and a
   *  re-sort here by call would group the room into camps on the page. */
  positions: Position[];
  /** Named, not merely absent. A case closed without somebody must say so in print
   *  or the panel looks unanimous when one member never answered. */
  closedEarly: { by: string; at: string; nonResponders: string[] } | null;
  findings: Finding[];
  inventory: Inventory;
  unanimity: UnanimityReport;
  disagreement: DisagreementReport | null;
  adjudication: Adjudication;
  /** A stub is labelled on the page in the largest warning this document has. An
   *  unlabelled stub in a PDF is the single most dangerous artefact this repo could
   *  emit: it looks exactly like a judgment about a compound. */
  adjudicationSource: "stub" | "live";
  adjudicatedAt: string | null;
  signature: Signature | null;
  audit: {
    chainFailures: number;
    sealFailures: number;
    entries: number;
    headHash: string | null;
  };
  /** Who pressed the button. A document that leaves the system says who made it. */
  generatedBy: ReportPerson;
  generatedAt: string;
}

const CALL_LABEL: Record<string, string> = {
  advance: "Advance",
  do_not_advance: "Do not advance",
  cannot_conclude: "Cannot conclude",
};

/** Three positions, three labels - and a fall-through to the raw value rather than a
 *  default, for the reason screens.tsx gives: an unrecognised position must look
 *  wrong, not look plausible. */
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

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Prose, kept as prose. Reviewers write paragraphs and a record that collapsed them
 *  into one block would change what a careful argument looks like on the page. */
function paragraphs(s: string): string {
  const blocks = s.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b !== "");
  if (blocks.length === 0) return "";
  return blocks.map((b) => `<p>${esc(b).replace(/\n/g, "<br>")}</p>`).join("\n");
}

/** A date a person reads, from an ISO string that may be anything. Invalid input is
 *  printed verbatim rather than rendered as "Invalid Date" - the record holds what it
 *  holds, and a reader should see the odd value rather than a formatter's opinion. */
export function readableDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * The filename, and it names the compound rather than the case id.
 *
 * A folder of `case_1174288393.pdf` is a folder nobody can search. The case id is on
 * the first page for the reader who needs to go back to the log; the filename is for
 * the person scrolling a downloads list a month later.
 */
export function reportFilename(input: Pick<ReportInput, "compoundLabel" | "caseId" | "generatedAt">): string {
  const slug = input.compoundLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const day = /^\d{4}-\d{2}-\d{2}/.exec(input.generatedAt)?.[0] ?? "undated";
  return `arbiter-${slug === "" ? input.caseId.replace(/[^a-zA-Z0-9]+/g, "-") : slug}-${day}.pdf`;
}

/**
 * THE MARK, and only the mark.
 *
 * `packages/design/src/Wordmark.tsx` builds ARBITER from about forty rectangles on a
 * shared grid. That geometry is not copied here: forty numbers duplicated into a
 * different package are forty numbers that drift, and the drift would show up as a
 * wordmark that is subtly not the product's. The notched square is the one glyph that
 * package publishes as standing alone - "usable on its own as a favicon or an avatar" -
 * so this document uses it beside letterspaced type, which is a use the mark is for.
 */
const MARK = `<svg class="mark" viewBox="0 0 14 14" fill="currentColor" role="img" aria-label="Arbiter"><path d="M0 0 H14 V8.68 L8.68 14 H0 Z"/></svg>`;

/**
 * The house style, and it is the evaluation report's.
 *
 * Georgia on white, one hairline rule, monospace for anything a reader may have to
 * type back into a terminal. Deliberately NOT the product's palette: the interface is
 * near-black navy with emissive accents because it is a lit room on a screen, and the
 * same values printed are a page of toner with white letters knocked out of it. The
 * brand survives the medium change as the mark, the type discipline and the voice; it
 * does not survive as a background colour.
 *
 * The accent blue is the product's `--color-accent-deep`, spent only on the masthead
 * rule and the mark. Red, green and amber are reserved here exactly as they are on
 * screen - they mean something specific on a safety call and are never decoration.
 */
const CSS = `
  @page { size: A4; margin: 20mm 16mm 18mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.55 Georgia, "Times New Roman", serif; color: #16181d; margin: 0; }
  h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 6pt; letter-spacing: -0.3pt; }
  h2 { font-size: 12.5pt; margin: 24pt 0 7pt; padding-bottom: 3pt; border-bottom: 1.5px solid #16181d; }
  h3 { font-size: 10.5pt; margin: 14pt 0 4pt; }
  p { margin: 0 0 8pt; }
  a { color: inherit; }
  .masthead { display: flex; align-items: center; justify-content: space-between;
              border-bottom: 2px solid #1e6fff; padding-bottom: 6pt; margin-bottom: 16pt; }
  .brand { display: flex; align-items: center; gap: 7pt; }
  .mark { width: 11pt; height: 11pt; color: #1e6fff; }
  .brand .word { font: 700 11pt/1 "Segoe UI", Helvetica, Arial, sans-serif; letter-spacing: 2.6pt; }
  .kind { font: 8.5pt/1 "Segoe UI", Helvetica, Arial, sans-serif; letter-spacing: 1.4pt;
          text-transform: uppercase; color: #5a6069; }
  .sub { color: #5a6069; font-size: 9.5pt; }
  .meta { font: 8.5pt/1.7 "Consolas", "Courier New", monospace; color: #41464e;
          border: 1px solid #d7dae0; background: #fafbfc; padding: 8pt 10pt; margin: 12pt 0 0; }
  .mono { font-family: "Consolas", "Courier New", monospace; font-size: 8.5pt; }
  .tiny { font-size: 8pt; }
  .decision { border: 1.5px solid #16181d; padding: 12pt 14pt; margin: 16pt 0 0; }
  .decision .l { font: 8pt/1 "Segoe UI", Helvetica, Arial, sans-serif; letter-spacing: 1.2pt;
                 text-transform: uppercase; color: #5a6069; margin-bottom: 5pt; }
  .decision .v { font-size: 17pt; line-height: 1.2; font-weight: 700; }
  /* Not scoped to the decision box: the same three words appear again as the
     adjudication's consequence call, and a verdict that is red on page one and black
     on page three reads as two different statements. */
  .stop { color: #9a2418; }
  .go { color: #12673a; }
  .hold { color: #8a5a00; }
  .stub { border: 2px solid #9a2418; color: #9a2418; padding: 10pt 12pt; margin: 14pt 0 0; }
  .stub strong { display: block; font-size: 11pt; margin-bottom: 3pt; }
  .unsigned { border-left: 3px solid #8a5a00; padding: 2pt 0 2pt 10pt; margin: 12pt 0 0; color: #6b5410; }
  .note { border-left: 2.5px solid #16181d; padding: 2pt 0 2pt 10pt; margin: 8pt 0 10pt; color: #33383f; }
  .concern { border-left: 2.5px solid #8a5a00; padding: 2pt 0 2pt 10pt; margin: 6pt 0; color: #4a3c0c; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; }
  th { text-align: left; border-bottom: 1.2px solid #16181d; padding: 4pt 5pt; font-weight: 700;
       font-family: "Segoe UI", Helvetica, Arial, sans-serif; font-size: 8pt;
       letter-spacing: 0.4pt; text-transform: uppercase; }
  td { border-bottom: 0.6px solid #e3e6ea; padding: 4pt 5pt; vertical-align: top; }
  td.n, th.n { text-align: right; font-family: "Consolas", "Courier New", monospace; white-space: nowrap; }
  .position { border-top: 0.8px solid #c8ccd3; padding: 9pt 0 4pt; }
  .position:first-of-type { border-top: 1.2px solid #16181d; }
  .who { display: flex; align-items: baseline; gap: 8pt; margin-bottom: 4pt; }
  .who .name { font-weight: 700; font-size: 11pt; }
  .who .call { font: 8.5pt/1 "Segoe UI", Helvetica, Arial, sans-serif; letter-spacing: 0.8pt;
               text-transform: uppercase; border: 1px solid #16181d; padding: 2.5pt 5pt; }
  .who .basis { font-size: 8.5pt; color: #5a6069; }
  .seat { font: 700 7.5pt/1 "Segoe UI", Helvetica, Arial, sans-serif; color: #5a6069;
          border: 1px solid #c8ccd3; border-radius: 50%; width: 15pt; height: 15pt;
          display: inline-flex; align-items: center; justify-content: center; }
  .cites { font-size: 8.5pt; color: #41464e; margin: 4pt 0 0; }
  .state { font: 7.5pt/1 "Segoe UI", Helvetica, Arial, sans-serif; letter-spacing: 0.6pt;
           text-transform: uppercase; padding: 2pt 4pt; border: 1px solid currentColor; }
  .present { color: #12673a; }
  .absent { color: #9a2418; }
  .inconclusive { color: #8a5a00; }
  .na { color: #5a6069; }
  .ok { color: #12673a; font-weight: 700; }
  .bad { color: #9a2418; font-weight: 700; }
  h2 { break-after: avoid; }
  h3 { break-after: avoid; }
  tr { break-inside: avoid; }
  .position { break-inside: avoid; }
  .decision, .stub { break-inside: avoid; }
`;

/** The consequence call, coloured the way the interface colours it. Green, amber and
 *  red carry meaning on a safety document, so an unrecognised verdict gets none. */
function verdictClass(verdict: string): string {
  return verdict === "advance" ? "go" : verdict === "do_not_advance" ? "stop" : verdict === "cannot_conclude" ? "hold" : "";
}

/** Name and address. NO seat badge: the table this appears in has a seat column, and
 *  the numeral printed twice on one row reads as two different numbers. */
function personLine(p: ReportPerson): string {
  return `<strong>${esc(p.displayName)}</strong> <span class="mono tiny">${esc(p.email)}</span>`;
}

/**
 * WHAT THE PANEL DECIDED, in the box a reader looks at first.
 *
 * The signature outranks the adjudication here, and that ordering is §6.7 on paper: a
 * committee advises, one named individual signs, and the signer may override. Printing
 * the model's consequence call as "the decision" would put the adjudication in the
 * place the human occupies - on the page most likely to be read by somebody who never
 * saw the difference on screen.
 */
function decisionBlock(input: ReportInput): string {
  const modelCall = CALL_LABEL[input.adjudication.consequence.verdict] ?? input.adjudication.consequence.verdict;
  const s = input.signature;

  if (s === null) {
    return `<div class="decision">
      <div class="l">The adjudication proposes</div>
      <div class="v ${verdictClass(input.adjudication.consequence.verdict)}">${esc(modelCall)}</div>
    </div>
    <div class="unsigned"><strong>Nobody has signed this.</strong> The panel has answered and the
    adjudication has run, but no named person has taken the decision, so this document records a
    deliberation in progress and not a decision. Anything below is what was said, never what was
    settled.</div>`;
  }

  // An override prints the SIGNER'S reason as the decision and the model's call beside
  // it, because that is the fact a later reader needs: a record that showed the
  // adjudication in the decision box and the override in a footnote would report the
  // overridden call as the outcome.
  return `<div class="decision">
    <div class="l">${s.agreesWithAdjudication ? "Signed" : "Signed - overriding the adjudication"}</div>
    <div class="v ${s.agreesWithAdjudication ? verdictClass(input.adjudication.consequence.verdict) : ""}">${
      s.agreesWithAdjudication ? esc(modelCall) : "Overridden"
    }</div>
    <p style="margin:8pt 0 0">by <strong>${esc(signerName(input))}</strong> on ${esc(readableDate(s.at))}${
      s.agreesWithAdjudication ? "" : `, against an adjudication that said <strong>${esc(modelCall)}</strong>`
    }.</p>
    ${s.reason.trim() === "" ? "" : `<div class="note" style="margin-bottom:0">${paragraphs(s.reason)}</div>`}
  </div>`;
}

function signerName(input: ReportInput): string {
  const s = input.signature;
  if (s === null) return "";
  return input.panel.concat(input.owner).find((p) => p.id === s.by)?.displayName ?? s.by;
}

/** Everyone's own words, whole. See the header: nothing on this path condenses a
 *  position, and the non-responders are named rather than left as an absence. */
function positionsSection(input: ReportInput, nameOf: (id: string) => ReportPerson | null): string {
  const findingLabel = new Map(input.findings.map((f) => [f.id, f] as const));

  const blocks = input.positions.map((p) => {
    const person = nameOf(p.participantId);
    const basis = positionBasis(p);
    const cites = p.citedFindingIds.map((id) => {
      const f = findingLabel.get(id);
      return f === undefined
        // A citation naming a finding this case no longer holds. It cannot happen
        // through the API - `submitPosition` rejects unknown ids at the door - so if
        // it ever prints, the record and the findings have diverged and the reader
        // should see that rather than a silently shortened list.
        ? `<li><span class="mono">${esc(id)}</span> - not among the findings printed below</li>`
        : `<li><strong>${esc(f.label)}</strong> <span class="tiny">asserts ${esc(f.assertion)}</span><br><span class="tiny">${esc(f.detail)}</span></li>`;
    }).join("\n");

    return `<div class="position">
      <div class="who">
        ${person === null || person.seat === null ? "" : `<span class="seat">${person.seat + 1}</span>`}
        <span class="name">${esc(person?.displayName ?? p.participantId)}</span>
        <span class="call">${esc(CALL_LABEL[p.call] ?? p.call)}</span>
        <span class="basis">${esc(BASIS_NOTE[basis] ?? basis)}</span>
      </div>
      ${paragraphs(p.reasoning)}
      ${cites === "" ? "" : `<div class="cites"><strong>Relying on:</strong><ul style="margin:3pt 0 0;padding-left:14pt">${cites}</ul></div>`}
      ${p.external.length === 0 ? "" : `<div class="cites"><strong>From outside these documents:</strong><ul style="margin:3pt 0 0;padding-left:14pt">${
        p.external.map((e) => `<li>&ldquo;${esc(e.claim)}&rdquo;${e.source === undefined || e.source.trim() === "" ? " <span class=\"tiny\">- no source given, so nothing in this case tests it</span>" : ` <span class="tiny">- ${esc(e.source)}</span>`}</li>`).join("\n")
      }</ul></div>`}
      <div class="tiny sub" style="margin-top:5pt">Sealed ${esc(readableDate(p.submittedAt))}</div>
    </div>`;
  }).join("\n");

  const absent = input.closedEarly?.nonResponders ?? [];
  const absentBlock = absent.length === 0 ? "" : `<div class="concern">
    <strong>${absent.length === 1 ? "One person on the panel never answered" : `${absent.length} people on the panel never answered`}:</strong>
    ${absent.map((id) => esc(nameOf(id)?.displayName ?? id)).join(", ")}.
    The case was closed without them by ${esc(nameOf(input.closedEarly?.by ?? "")?.displayName ?? input.closedEarly?.by ?? "the convener")}
    on ${esc(readableDate(input.closedEarly?.at ?? ""))}. Their silence is not agreement, and this
    document counts them as neither.
  </div>`;

  return `${absentBlock}${blocks}`;
}

/** Agreement, and what it is not. §6.6: unanimity beside an unanswered question is a
 *  fact about the record and it is checkable arithmetic - no model produced any line
 *  in this section. */
function agreementSection(input: ReportInput): string {
  const u = input.unanimity;
  const d = input.disagreement;

  if (u.unanimous) {
    return `<p>Every position on this case was <strong>${esc(CALL_LABEL[u.call ?? ""] ?? String(u.call))}</strong>.
    That is agreement, which is not the same as being right, and nothing below came from a model.</p>
    ${u.concerns.length === 0
      ? `<p class="ok">No unanswered questions, and every position rests on cited evidence.</p>`
      : u.concerns.map((c) => `<div class="concern">${esc(c)}</div>`).join("\n")}`;
  }

  if (d === null) {
    return `<p>Not enough positions to describe agreement or a split.</p>`;
  }

  const camps = d.split.map((s) => `<tr><td><strong>${esc(CALL_LABEL[s.call] ?? s.call)}</strong></td><td>${
    s.participantIds.map((id) => esc(input.panel.find((p) => p.id === id)?.displayName ?? id)).join(", ")
  }</td><td class="n">${s.participantIds.length}</td></tr>`).join("\n");

  const labelOf = (id: string): string => input.findings.find((f) => f.id === id)?.label ?? id;

  return `<p>The panel split. Where it split, and on what evidence, is arithmetic over the
  positions - it is deliberately not a judgment about who is right, because deciding which
  reading of a finding is correct is the work the adjudication and the signer do.</p>
  <table><tr><th>call</th><th>who</th><th class="n">n</th></tr>${camps}</table>
  ${d.contested.length === 0 ? "" : `<h3>The same evidence, read two ways</h3>
  <p class="sub">Cited by more than one camp. This is common ground being read differently, and it is
  usually the conversation worth having.</p>
  <ul>${d.contested.map((id) => `<li>${esc(labelOf(id))} <span class="mono tiny">${esc(id)}</span></li>`).join("\n")}</ul>`}
  ${d.oneSided.length === 0 ? "" : `<h3>Cited by one side only</h3>
  <p class="sub">Evidence the other camp did not answer.</p>
  <ul>${d.oneSided.map((o) => `<li>${esc(labelOf(o.findingId))} <span class="tiny">- cited only by those who said ${esc(CALL_LABEL[o.call] ?? o.call)}</span></li>`).join("\n")}</ul>`}`;
}

function adjudicationSection(input: ReportInput): string {
  const a = input.adjudication;
  const labelOf = (id: string): string => input.findings.find((f) => f.id === id)?.label ?? id;
  const cited = (ids: string[]): string => ids.length === 0
    ? `<div class="tiny sub">Cites no finding.</div>`
    : `<div class="tiny sub">Cites: ${ids.map((id) => esc(labelOf(id))).join("; ")}</div>`;

  return `<h3>Mechanism - is there a route to liver injury?</h3>
  <p><strong>${a.mechanism.present ? "Present." : "Not established."}</strong>
  ${a.mechanism.pathway === null ? "" : esc(a.mechanism.pathway)}</p>
  ${cited(a.mechanism.citedFindingIds)}

  <h3>Consequence - is it severe enough to stop?</h3>
  <p><strong class="${verdictClass(a.consequence.verdict)}">${esc(CALL_LABEL[a.consequence.verdict] ?? a.consequence.verdict)}</strong></p>
  ${paragraphs(a.consequence.reasoning)}
  ${cited(a.consequence.citedFindingIds)}
  ${a.consequenceBasis.length === 0
    // Printed as an absence rather than omitted. A severity call resting on no measured
    // consequence-half evidence is the exact defect §0 records - the engine calling
    // do_not_advance on mechanism evidence alone - and it is invisible unless the empty
    // list is on the page.
    ? `<div class="concern">The severity call names no measured consequence-half evidence - no dose, no
       exposure margin, no injury pattern, no reversibility. A mechanism can be real and still not be
       a reason to stop.</div>`
    : `<div class="tiny sub">Severity rests on: ${a.consequenceBasis.map((b) => esc(b)).join("; ")}</div>`}

  <h3>Every rule, answered</h3>
  <p class="sub">One line per registered rule, including the rules that did not apply. A rule nobody
  could answer is reported as such rather than as a rule answered in the negative.</p>
  <table>
    <tr><th style="width:52pt">rule</th><th style="width:96pt">position</th><th>why</th></tr>
    ${a.ruleDisclosure.map((r) => `<tr>
      <td class="mono">${esc(r.ruleId)}</td>
      <td>${esc(RULE_POSITION_LABEL[r.position] ?? r.position)}</td>
      <td>${esc(r.reasoning)}${r.citedFindingIds.length === 0 ? "" : `<br><span class="tiny sub">${r.citedFindingIds.map((id) => esc(labelOf(id))).join("; ")}</span>`}</td>
    </tr>`).join("\n")}
  </table>

  ${a.missing.length === 0 ? "" : `<h3>Still unanswered</h3>
  <table><tr><th style="width:38%">question</th><th>why it matters</th></tr>
  ${a.missing.map((m) => `<tr><td>${esc(m.field)}</td><td>${esc(m.whyItMatters)}</td></tr>`).join("\n")}</table>`}

  ${a.nextExperiment === null ? "" : `<h3>What would settle it</h3>${paragraphs(a.nextExperiment)}`}`;
}

function evidenceSection(input: ReportInput): string {
  const inv = input.inventory;
  const absent = inv.entries.filter((e) => e.state === "absent");
  const inconclusive = inv.entries.filter((e) => e.state === "inconclusive");
  const na = inv.entries.filter((e) => e.state === "not_applicable");
  const stateClass: Record<string, string> = {
    present: "present", absent: "absent", inconclusive: "inconclusive", not_applicable: "na",
  };

  return `<p>Checklist v${esc(inv.checklistVersion)} against a ${esc(inv.modality.replace("_", " "))}.
  ${absent.length} of ${inv.entries.length} questions unanswered${
    inconclusive.length === 0 ? "" : `, ${inconclusive.length} tested and unresolved`}${
    na.length === 0 ? "" : `, ${na.length} that ${na.length === 1 ? "does" : "do"} not arise for this modality and ${na.length === 1 ? "is" : "are"} marked n/a rather than missing`}.
  Ordered by checklist id and by nothing else - ordering gaps by importance would rank them, and
  nothing in this system ranks a gap.</p>

  <table>
    <tr><th style="width:32pt">id</th><th style="width:64pt">state</th><th>question</th><th style="width:34%">what it blocks</th></tr>
    ${inv.entries.map((e) => `<tr>
      <td class="mono">${esc(e.itemId)}</td>
      <td><span class="state ${stateClass[e.state] ?? "na"}">${e.state === "not_applicable" ? "n/a" : esc(e.state)}</span></td>
      <td>${esc(e.field)}${e.findingIds.length === 0 ? "" : `<br><span class="mono tiny sub">${e.findingIds.map((id) => esc(id)).join(", ")}</span>`}</td>
      <td class="tiny">${esc(e.state === "not_applicable" ? (e.whyNotApplicable ?? "Does not apply to this kind of drug.") : e.whatItBlocks)}</td>
    </tr>`).join("\n")}
  </table>

  <h3>The findings the panel answered against</h3>
  ${input.findings.length === 0
    ? `<p class="bad">This case holds no findings at all. Every position on it was reached against an empty inventory.</p>`
    : `<table>
      <tr><th style="width:64pt">asserts</th><th style="width:34%">what was measured</th><th>what it said</th><th style="width:76pt">source</th></tr>
      ${input.findings.map((f) => `<tr>
        <td><span class="state ${f.assertion === "toxic" ? "absent" : f.assertion === "safe" ? "present" : "inconclusive"}">${esc(f.assertion)}</span></td>
        <td><strong>${esc(f.label)}</strong><br><span class="mono tiny sub">${esc(f.id)}</span></td>
        <td>${esc(f.detail)}${f.sourceQuote === undefined ? "" : `<br><span class="tiny">&ldquo;${esc(f.sourceQuote)}&rdquo;</span>`}</td>
        <td class="tiny">${f.sourceDocument === undefined && f.sourcePage === undefined
          ? "<span class=\"sub\">not anchored</span>"
          : `${esc(f.sourceDocument ?? "uploaded document")}${f.sourcePage === undefined ? "" : `<br>p. ${f.sourcePage}`}`}</td>
      </tr>`).join("\n")}
    </table>`}`;
}

function recordSection(input: ReportInput): string {
  const clean = input.audit.chainFailures === 0 && input.audit.sealFailures === 0;
  return `<p class="${clean ? "ok" : "bad"}">${clean
    ? "Chain intact, and every revealed position matches the commitment written while the case was blind."
    : `TAMPERING DETECTED: ${input.audit.chainFailures} chain failure${input.audit.chainFailures === 1 ? "" : "s"}, ${input.audit.sealFailures} seal failure${input.audit.sealFailures === 1 ? "" : "s"}. Do not rely on this document; go and read the log.`}</p>
  <p>What that proves: no position was edited after it was sealed - the commitment hash is written
  to the log while the case is still open and before anything is revealed, so the plaintext published
  at reveal must hash to it. What it does not prove: that the server never read a position early. No
  server-side scheme can, and claiming otherwise would be the more dangerous error.</p>
  <div class="meta">
case . . . . . . . . ${esc(input.caseId)}<br>
entries in the log . ${input.audit.entries}<br>
head hash. . . . . . ${esc(input.audit.headHash ?? "none")}<br>
chain failures . . . ${input.audit.chainFailures}<br>
seal failures. . . . ${input.audit.sealFailures}
  </div>
  <div class="note"><strong>This paper carries no chain.</strong> A PDF can be edited by anybody
  holding it, and this one has no signature over its own bytes. What makes it checkable is that it
  names the case and the head hash above: a reader who doubts this document can open the record it
  was printed from and compare.</div>`;
}

/**
 * The whole document, as a self-contained page.
 *
 * No web font, no image, no network at print time - so the same record produces the
 * same document on a machine with no connectivity, which is the property that lets
 * this be regenerated years later and compared with a copy somebody filed.
 */
export function renderReportHtml(input: ReportInput): string {
  const byId = new Map(input.panel.concat(input.owner).map((p) => [p.id, p] as const));
  const nameOf = (id: string): ReportPerson | null => byId.get(id) ?? null;
  const answered = input.positions.length;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>ARBITER - ${esc(input.compoundLabel)} - deliberation record</title>
<style>${CSS}</style></head><body>

<div class="masthead">
  <div class="brand">${MARK}<span class="word">ARBITER</span></div>
  <div class="kind">Deliberation record</div>
</div>

<h1>${esc(input.compoundLabel)}</h1>
${input.context.trim() === "" ? "" : `<p class="sub">${esc(input.context)}</p>`}

${input.adjudicationSource === "stub" ? `<div class="stub">
  <strong>STUB - NO MODEL WAS CALLED.</strong>
  The adjudication printed in this document was produced by a placeholder, not by a model reading
  this case. The wiring is real; the words are not a judgment about this compound and must not be
  quoted as one. Everything the panel said is genuine; everything attributed to the adjudication
  below is not.
</div>` : ""}

${decisionBlock(input)}

<div class="meta">
case. . . . . . . ${esc(input.caseId)}<br>
status. . . . . . ${esc(input.status)}<br>
convened by . . . ${esc(input.owner.displayName)} &lt;${esc(input.owner.email)}&gt;<br>
panel . . . . . . ${input.panel.length} named, ${answered} answered<br>
adjudicated . . . ${input.adjudicatedAt === null ? "-" : esc(readableDate(input.adjudicatedAt))} (${input.adjudicationSource === "stub" ? "STUB - no model" : "model"})<br>
generated . . . . ${esc(readableDate(input.generatedAt))} by ${esc(input.generatedBy.displayName)}
</div>

<h2>1. Who answered</h2>
<p>The convener chooses who answers and signs at the end, and does not answer - so nobody both sets
the question and votes on it. Every position below was sealed before any of them could see another.</p>
<table>
  <tr><th style="width:34pt">seat</th><th>on the panel</th><th style="width:96pt">answered</th></tr>
  ${input.panel.map((p) => `<tr>
    <td class="n">${p.seat === null ? "-" : p.seat + 1}</td>
    <td>${personLine(p)}${p.id === input.owner.id ? ' <span class="tiny sub">- convener</span>' : ""}</td>
    <td>${input.positions.some((x) => x.participantId === p.id)
      ? '<span class="state present">sealed</span>'
      : '<span class="state absent">no answer</span>'}</td>
  </tr>`).join("\n")}
  ${input.panel.some((p) => p.id === input.owner.id) ? "" : `<tr>
    <td class="n">-</td><td>${personLine(input.owner)} <span class="tiny sub">- convener, does not answer</span></td>
    <td><span class="state na">n/a</span></td>
  </tr>`}
</table>

<h2>2. What each person said</h2>
<p>In full, in their own words, at the same size. Nothing here is summarised and nothing is ranked:
the order is the order the record holds, which is deliberately not submission order - first to answer
reads as most confident and last as most considered, and neither is information about the compound.</p>
${positionsSection(input, nameOf)}

<h2>3. Where the panel agreed, and where it split</h2>
${agreementSection(input)}

<h2>4. The adjudication</h2>
<p class="sub">Produced by a model, after the reveal and never before, reading the positions above and
the evidence below. It advises. It decided nothing: the decision is at the top of page one and it
carries a person's name.</p>
${adjudicationSection(input)}

<h2>5. The evidence this was decided on</h2>
${evidenceSection(input)}

<h2>6. The record</h2>
${recordSection(input)}

</body></html>`;
}
