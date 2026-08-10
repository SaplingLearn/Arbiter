import type { Finding } from "./adjudicate.js";

/**
 * The inventory. Spec §3.1 (two-phase disclosure) and §3.2 (absence is a finding).
 *
 * WHAT THIS IS FOR. Before anybody states a position, everybody sees the same
 * neutral account of what the documents do and do not contain. That is the "before"
 * half of the two-phase disclosure, and it is the honest half of the product: it
 * contains no verdict, no score and no recommendation, and it is computed by this
 * file rather than by a model.
 *
 * NO MODEL RUNS HERE, AND THAT IS THE POINT. Participants cite findings from this
 * list (§6.5), and the citation check is deterministic only because the list is.
 * If a model decided what counted as present, a model would be deciding which
 * dissent was admissible - which §6.4 forbids for the same reason vote tallies are
 * forbidden.
 *
 * FLAT AND UNRANKED, ENFORCED. Entries come out sorted by checklist id and by
 * nothing else. Ordering by severity, or by "most important gap", would be the
 * system nudging before anyone has spoken, which is the exact failure the two-phase
 * split exists to prevent. §9 records that naming a gap nudges at all; unranked
 * output mitigates that, it does not eliminate it.
 */

export type Modality = "small_molecule" | "biologic";

export interface ChecklistItem {
  id: string;
  half: "mechanism" | "consequence";
  field: string;
  whatItBlocks: string;
  /** Omitted means "applies to everything" - see `not_applicable` below. */
  appliesTo?: Modality[];
  /**
   * Why the question does not arise, shown INSTEAD OF `whatItBlocks` when the state
   * is not_applicable.
   *
   * They answer different questions and are not interchangeable. `whatItBlocks` says
   * what goes wrong when a question is unanswered; for a question that does not
   * arise, nothing goes wrong. Rendering the gap sentence beside an n/a badge made
   * four non-issues read as four untested liabilities - the exact false alarm this
   * state was added to prevent.
   */
  whyNotApplicable?: string;
}

export interface EvidenceChecklist {
  version: string;
  items: ChecklistItem[];
}

/**
 * Three states, and every checklist item lands in exactly one.
 *
 * `present` does NOT mean reassuring and does not mean the findings agree. Two
 * findings that contradict each other still make the item present: the evidence
 * exists, and reconciling it is what the deliberation is for. Folding disagreement
 * into `inconclusive` would hide a live conflict inside a word that reads like a
 * gap, and the conflict is the most valuable thing on the page.
 *
 * `inconclusive` means covered only by findings that resolve neither way - the
 * engine's `ambiguous` assertion. Someone looked, and the looking did not settle it.
 * That is materially different from nobody having looked, and collapsing the two is
 * how "we ran the study" comes to read the same as "we have the answer".
 *
 * `absent` means no finding claims to cover the item at all.
 *
 * `not_applicable` means the question does not arise for this kind of drug, and it is
 * the difference between a gap and a category error. A monoclonal antibody is
 * catabolised to amino acids, so it has no reactive metabolite to assess; it does not
 * inhibit hepatobiliary transporters; QSAR models are built for small molecules.
 * Listing those as unanswered would be the same false alarm as calling an approved
 * BSEP inhibitor disqualifying - it fills the missing-evidence list with items nobody
 * can ever supply, and a list like that gets ignored wholesale, taking the real gaps
 * with it.
 *
 * DECLARED, NOT INFERRED, exactly like coverage: the checklist item names the
 * modalities it applies to and the case names its modality. Nothing here reasons
 * about whether a compound "looks like" a biologic. An item with NO declared
 * modality applies to everything, so forgetting the field asks the question rather
 * than silently dropping it.
 */
export type InventoryState = "present" | "inconclusive" | "absent" | "not_applicable";

export interface InventoryEntry {
  itemId: string;
  half: "mechanism" | "consequence";
  field: string;
  whatItBlocks: string;
  state: InventoryState;
  /** Present exactly when the state is `not_applicable`. The renderer shows this in
   *  place of `whatItBlocks`, never alongside it. */
  whyNotApplicable?: string;
  /** Empty when the state is `absent` or `not_applicable`. Non-empty otherwise. */
  findingIds: string[];
}

export interface Inventory {
  checklistVersion: string;
  modality: Modality;
  entries: InventoryEntry[];
  /** Findings that declared coverage of an id the checklist does not contain. */
  unmappedFindingIds: string[];
}

/**
 * Coverage is DECLARED, never inferred.
 *
 * A finding covers a checklist item when it says so in `covers`. There is no
 * keyword matching on labels or stream names, and that was a deliberate rejection:
 * guessing that a finding named `invivo_rodent` satisfies "repeat-dose in vivo liver
 * findings" is a guess that fails silently in the dangerous direction - it marks an
 * item satisfied that nobody verified, and a satisfied item never appears on the
 * missing-evidence list again.
 *
 * The cost is that an undeclared finding leaves its item `absent`. That error is
 * loud, appears on the inventory everybody reads, and is fixed by declaring the
 * coverage. The opposite error is silent. When extraction runs (spec §4.2 phase 2)
 * it populates this field and a human approves it, so the declaration carries a
 * human signature rather than a heuristic.
 */
export interface CoveringFinding extends Finding {
  covers?: string[];
  /** The uploaded document this came from. A page number alone is ambiguous the
   *  moment a case holds two documents, and "page 26" of an unnamed file is not a
   *  citation anybody can follow. */
  sourceDocumentId?: string;
}

export function buildInventory(
  findings: CoveringFinding[],
  checklist: EvidenceChecklist,
  modality: Modality = "small_molecule",
): Inventory {
  const known = new Set(checklist.items.map((i) => i.id));
  const byItem = new Map<string, CoveringFinding[]>();
  const unmapped = new Set<string>();

  for (const f of findings) {
    for (const itemId of f.covers ?? []) {
      if (!known.has(itemId)) {
        unmapped.add(f.id);
        continue;
      }
      const list = byItem.get(itemId);
      if (list === undefined) byItem.set(itemId, [f]);
      else list.push(f);
    }
  }

  const entries: InventoryEntry[] = checklist.items.map((item) => {
    const covering = byItem.get(item.id) ?? [];
    const applies = item.appliesTo === undefined || item.appliesTo.includes(modality);
    // Applicability is checked BEFORE coverage, and deliberately not after: an item
    // that does not apply is not-applicable even if some finding declared it, because
    // the declaration would be the mistake. Checking coverage first would let one
    // stray `covers` entry silently reinstate a question that does not arise.
    const state: InventoryState = !applies
      ? "not_applicable"
      : covering.length === 0
        ? "absent"
        : covering.every((f) => f.assertion === "ambiguous")
          ? "inconclusive"
          : "present";
    return {
      itemId: item.id,
      half: item.half,
      field: item.field,
      whatItBlocks: item.whatItBlocks,
      state,
      ...(state === "not_applicable" && item.whyNotApplicable !== undefined
        ? { whyNotApplicable: item.whyNotApplicable }
        : {}),
      // Sorted so the entry is a stable object: the same evidence produces the same
      // inventory regardless of the order findings were loaded in. The inventory is
      // hashed into the deliberation log, so load order must not change the hash.
      findingIds: applies ? covering.map((f) => f.id).sort() : [],
    };
  });

  entries.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

  return {
    checklistVersion: checklist.version,
    modality,
    entries,
    unmappedFindingIds: [...unmapped].sort(),
  };
}

/**
 * The absences, in the shape `handleAdjudicate` already accepts.
 *
 * This is the join between the two halves of the redesign: the same list the humans
 * read before they answer is the list the model is told about, so a gap cannot be
 * visible to one and not the other. `inconclusive` is included, with its state named
 * in the field - an item somebody tested inconclusively is still an unanswered
 * question, and dropping it here would tell the model the question was settled.
 */
export function absentForAdjudication(inv: Inventory): { field: string; whatItBlocks: string }[] {
  return inv.entries
    // `not_applicable` is excluded, and that exclusion is the point of the state.
    // Telling the model a monoclonal antibody is missing its QSAR assessment invites
    // it to recommend an experiment nobody can run.
    .filter((e) => e.state !== "present" && e.state !== "not_applicable")
    .map((e) => ({
      field: e.state === "inconclusive" ? `${e.field} (tested, inconclusive)` : e.field,
      whatItBlocks: e.whatItBlocks,
    }));
}

export function isChecklist(u: unknown): u is EvidenceChecklist {
  if (typeof u !== "object" || u === null) return false;
  const c = u as Record<string, unknown>;
  if (typeof c["version"] !== "string") return false;
  if (!Array.isArray(c["items"]) || c["items"].length === 0) return false;
  const ids = new Set<string>();
  for (const raw of c["items"] as unknown[]) {
    const i = raw as Record<string, unknown>;
    if (typeof i?.["id"] !== "string" || i["id"].trim() === "") return false;
    if (i["half"] !== "mechanism" && i["half"] !== "consequence") return false;
    if (typeof i?.["field"] !== "string" || typeof i?.["whatItBlocks"] !== "string") return false;
    if (i["whyNotApplicable"] !== undefined && typeof i["whyNotApplicable"] !== "string") return false;
    const a = i["appliesTo"];
    if (a !== undefined) {
      if (!Array.isArray(a) || a.length === 0) return false;
      if (!a.every((m) => m === "small_molecule" || m === "biologic")) return false;
    }
    // Duplicate ids would make an item's state depend on which copy won, and the
    // inventory's exhaustiveness claim ("every item lands in exactly one state")
    // would quietly become false.
    if (ids.has(i["id"])) return false;
    ids.add(i["id"]);
  }
  return true;
}
