/**
 * Turning what a reader typed and what the document wrote into the same tokens.
 *
 * WHY THIS EXISTS, MEASURED. On the fixture in `data/retrieval-eval.json`, the plain
 * BM25 retriever found a page holding the answer for 55.6% of questions, and asking
 * the same question in different words returned almost disjoint page sets - 12.9%
 * mean overlap, and 0% between "What NOAEL was set?" and "no observed adverse effect
 * level", which is an acronym and its own expansion. Eight of eighteen questions
 * retrieved nothing useful, and every one of the eight failed on vocabulary rather
 * than on meaning: "hepatotoxicity" against a page that says "hepatic", "does this
 * drug damage the liver" against a page that says ALT and AST.
 *
 * Three deterministic layers, applied identically to the query and to the page, which
 * is the part that matters - normalising one side only moves the mismatch rather than
 * removing it.
 *
 *   PHRASES, before tokenisation, because "no observed adverse effect level" is five
 *   tokens and NOAEL is one. The acronym is ADDED, never substituted: a page that
 *   only ever spells it out must still match a reader who only ever abbreviates.
 *
 *   STEMMING, the published Porter algorithm rather than a hand-rolled suffix
 *   stripper. A stemmer that is subtly wrong changes every number in the retrieval
 *   eval while looking like a retrieval result, so this one is checked against
 *   Porter's own worked examples in the tests.
 *
 *   CONCEPTS, a short curated map of the words this domain uses interchangeably. It
 *   is deliberately small and every entry is defensible to a toxicologist: liver and
 *   hepatic are the same organ, ALT and AST are how a study says liver. It is not a
 *   thesaurus and must not become one - each entry trades precision for recall, and
 *   the retrieval eval is what says whether the trade paid.
 *
 * NO MODEL, NO NETWORK, NO STATE. Same input, same tokens, forever - which is what
 * lets `retrieval.ts` keep claiming a deterministic retriever, and what makes a
 * before-and-after measurement mean anything.
 */

/* ------------------------------------------------------------------ stemming */

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

const isConsonant = (w: string, i: number): boolean => {
  const c = w[i]!;
  if (VOWELS.has(c)) return false;
  // y is a consonant unless the letter before it is one: "toy" versus "syzygy".
  return c !== "y" || i === 0 || !isConsonant(w, i - 1);
};

/** Porter's m: how many vowel-consonant sequences the stem holds. */
const measure = (w: string): number => {
  let m = 0;
  let i = 0;
  while (i < w.length && isConsonant(w, i)) i++;
  while (i < w.length) {
    while (i < w.length && !isConsonant(w, i)) i++;
    if (i >= w.length) break;
    m++;
    while (i < w.length && isConsonant(w, i)) i++;
  }
  return m;
};

const hasVowel = (w: string): boolean => {
  for (let i = 0; i < w.length; i++) if (!isConsonant(w, i)) return true;
  return false;
};

const endsDoubleConsonant = (w: string): boolean =>
  w.length >= 2 && w[w.length - 1] === w[w.length - 2] && isConsonant(w, w.length - 1);

/** Porter's *o: consonant-vowel-consonant where the last is not w, x or y. */
const cvc = (w: string): boolean => {
  if (w.length < 3) return false;
  const last = w[w.length - 1]!;
  return isConsonant(w, w.length - 3) && !isConsonant(w, w.length - 2)
    && isConsonant(w, w.length - 1) && !["w", "x", "y"].includes(last);
};

const STEP2: [string, string][] = [
  ["ational", "ate"], ["tional", "tion"], ["enci", "ence"], ["anci", "ance"],
  ["izer", "ize"], ["abli", "able"], ["alli", "al"], ["entli", "ent"], ["eli", "e"],
  ["ousli", "ous"], ["ization", "ize"], ["ation", "ate"], ["ator", "ate"],
  ["alism", "al"], ["iveness", "ive"], ["fulness", "ful"], ["ousness", "ous"],
  ["aliti", "al"], ["iviti", "ive"], ["biliti", "ble"],
];

const STEP3: [string, string][] = [
  ["icate", "ic"], ["ative", ""], ["alize", "al"], ["iciti", "ic"], ["ical", "ic"],
  ["ful", ""], ["ness", ""],
];

const STEP4 = [
  "al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement", "ment", "ent",
  "ion", "ou", "ism", "ate", "iti", "ous", "ive", "ize",
];

/**
 * The Porter stemmer. Words of three letters or fewer are returned untouched - this
 * domain is full of them (ALT, AST, AUC, dog, rat) and every one is a term somebody
 * searches for.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;

  // Step 1a
  if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("ies")) w = w.slice(0, -2);
  else if (w.endsWith("ss")) { /* kept */ }
  else if (w.endsWith("s")) w = w.slice(0, -1);

  // Step 1b. Longest matching suffix wins, and if its condition fails nothing fires -
  // which is why "feed" survives whole while "agreed" becomes "agree".
  let step1bApplied = false;
  if (w.endsWith("eed")) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
  } else if (w.endsWith("ed") && hasVowel(w.slice(0, -2))) {
    w = w.slice(0, -2);
    step1bApplied = true;
  } else if (w.endsWith("ing") && hasVowel(w.slice(0, -3))) {
    w = w.slice(0, -3);
    step1bApplied = true;
  }
  if (step1bApplied) {
    if (w.endsWith("at") || w.endsWith("bl") || w.endsWith("iz")) w += "e";
    else if (endsDoubleConsonant(w) && !["l", "s", "z"].includes(w[w.length - 1]!)) w = w.slice(0, -1);
    else if (measure(w) === 1 && cvc(w)) w += "e";
  }

  // Step 1c
  if (w.endsWith("y") && hasVowel(w.slice(0, -1))) w = `${w.slice(0, -1)}i`;

  // Step 2
  for (const [suffix, replacement] of STEP2) {
    if (w.endsWith(suffix)) {
      if (measure(w.slice(0, -suffix.length)) > 0) w = w.slice(0, -suffix.length) + replacement;
      break;
    }
  }

  // Step 3
  for (const [suffix, replacement] of STEP3) {
    if (w.endsWith(suffix)) {
      if (measure(w.slice(0, -suffix.length)) > 0) w = w.slice(0, -suffix.length) + replacement;
      break;
    }
  }

  // Step 4. Longest suffix first, so "ement" is tried before "ment" and "ent".
  for (const suffix of [...STEP4].sort((a, b) => b.length - a.length)) {
    if (!w.endsWith(suffix)) continue;
    const base = w.slice(0, -suffix.length);
    if (measure(base) > 1 && (suffix !== "ion" || base.endsWith("s") || base.endsWith("t"))) w = base;
    break;
  }

  // Step 5
  if (w.endsWith("e")) {
    const base = w.slice(0, -1);
    if (measure(base) > 1 || (measure(base) === 1 && !cvc(base))) w = base;
  }
  if (measure(w) > 1 && endsDoubleConsonant(w) && w.endsWith("l")) w = w.slice(0, -1);

  return w;
}

/* ------------------------------------------------------------------- phrases */

/**
 * Multi-word forms that mean a single term, expanded before tokenisation.
 *
 * Every entry is a form that appears in FDA and EMA review prose, and each was added
 * because a question in the fixture used one form while the document used the other.
 */
const PHRASES: [RegExp, string][] = [
  [/no[\s-]*observed[\s-]*adverse[\s-]*effect[\s-]*level/g, "noael"],
  [/no[\s-]*observed[\s-]*effect[\s-]*level/g, "noel"],
  [/lowest[\s-]*observed[\s-]*adverse[\s-]*effect[\s-]*level/g, "loael"],
  [/alanine[\s-]*amino[\s-]*transferase/g, "alt"],
  [/aspartate[\s-]*amino[\s-]*transferase/g, "ast"],
  [/gamma[\s-]*glutamyl[\s-]*transferase/g, "ggt"],
  [/alkaline[\s-]*phosphatase/g, "alp"],
  [/area[\s-]*under[\s-]*the[\s-]*curve/g, "auc"],
  [/drug[\s-]*induced[\s-]*liver[\s-]*injury/g, "dili"],
  [/exposure[\s-]*margin|safety[\s-]*margin|margin[\s-]*of[\s-]*exposure|safety[\s-]*multiple/g, "margin"],
  [/repeat[\s-]*dose|repeated[\s-]*dose/g, "repeatdose"],
  [/animal[\s-]*stud(?:y|ies)|nonclinical[\s-]*stud(?:y|ies)|non-clinical[\s-]*stud(?:y|ies)/g, "nonclinical"],
];

/**
 * The text with any recognised phrase's short form appended.
 *
 * APPENDED, and the distinction is load-bearing: substituting would delete the words
 * a reader might have typed. A page that writes "alanine aminotransferase" in full
 * and never once writes ALT still has to match somebody searching for ALT, and the
 * reverse.
 */
export function expandPhrases(text: string): string {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const [pattern, short] of PHRASES) {
    // Fresh lastIndex per call: these are module-level /g regexes.
    pattern.lastIndex = 0;
    if (pattern.test(lower)) found.add(short);
  }
  return found.size === 0 ? lower : `${lower} ${[...found].join(" ")}`;
}

/* ------------------------------------------------------------------ concepts */

/**
 * Words a reviewer uses for the same thing, each mapped onto one concept token.
 *
 * SMALL ON PURPOSE. Every entry buys recall with precision, and an aggressive list
 * would quietly make the retriever worse while looking like an improvement - which is
 * exactly what the retrieval eval is for. The liver entry earns its place three times
 * over: "hepatotoxicity in the animal studies", "does this drug damage the liver" and
 * "were transaminases elevated" all missed every gold page, against a document whose
 * relevant pages say "hepatic", "hemosiderin deposition" and "ALT and AST".
 */
const CONCEPTS: Record<string, string[]> = {
  c_liver: [
    "liver", "hepatic", "hepatotoxicity", "hepatotoxic", "hepatocellular", "hepatocyte",
    "hepatobiliary", "hepatitis", "biliary", "cholestasis", "cholestatic", "dili",
    "transaminase", "aminotransferase", "alt", "ast", "ggt", "alp", "bilirubin",
  ],
  c_noael: ["noael", "noel", "loael"],
  c_exposure: ["auc", "cmax", "exposure", "margin", "multiple"],
  c_recovery: ["recovery", "reversibility", "reversible", "resolved", "resolution"],
  c_nonclinical: ["nonclinical", "preclinical", "animal", "toxicology", "toxicity"],
  c_histopathology: ["histopathology", "histopathological", "histology", "histological", "microscopic", "necrosis", "necrotizing"],
};

/** Surface form (stemmed) to the concepts it belongs to. Built once. */
const CONCEPT_OF = new Map<string, string[]>();
for (const [concept, forms] of Object.entries(CONCEPTS)) {
  for (const form of forms) {
    const key = stem(form);
    CONCEPT_OF.set(key, [...(CONCEPT_OF.get(key) ?? []), concept]);
  }
}

export function conceptsFor(stemmed: string): string[] {
  return CONCEPT_OF.get(stemmed) ?? [];
}

/* ------------------------------------------------------------------ pipeline */

/**
 * Words carried by nearly every page of a regulatory document, which therefore
 * separate nothing. Kept deliberately SHORT: an aggressive list silently removes
 * terms that are discriminating in this domain, and BM25's idf already suppresses
 * common words on its own. This is a floor for the obvious, not a substitute for it.
 */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "at", "by", "with",
  "is", "was", "were", "are", "be", "been", "that", "this", "these", "those", "it",
  "as", "from", "has", "have", "had", "not", "no", "any", "all", "which", "than",
  "there", "their", "they", "we", "its", "if", "but", "can", "may", "will", "would",
  "what", "does", "do", "did", "how", "when", "where", "who", "why",
]);

/**
 * The one tokenisation, used for the query and for the page.
 *
 * NUMBERS ARE KEPT, and that is not incidental. "NOAEL 100 mg/kg", "44x", "6.7x" and
 * a page's exposure margins are exactly what somebody asks about, and a tokeniser
 * that discarded digits would make the most citable facts in the document the least
 * findable.
 */
export function normalise(text: string): string[] {
  const out: string[] = [];
  for (const raw of expandPhrases(text).split(/[^a-z0-9]+/)) {
    if (raw.length <= 1 || STOP.has(raw)) continue;
    const stemmed = stem(raw);
    out.push(stemmed);
    out.push(...conceptsFor(stemmed));
  }
  return out;
}
