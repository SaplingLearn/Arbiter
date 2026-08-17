import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { stripBoilerplate } from "./pages.js";

/**
 * Document upload. Spec §3.3 - the storage row.
 *
 * MEASURED BEFORE IT IS ACCEPTED. Two of the first five documents collected for this
 * project were unusable, and neither failure was visible without measuring: one was
 * 48 pages of scanned images carrying zero extractable characters, and one was 133
 * pages of perfectly readable text that turned out to be a labelling supplement with
 * no toxicology review in it. Both would have produced a confident, empty case.
 *
 * So an upload that cannot be read is REFUSED at the door and the reason is reported
 * to the person who uploaded it, while they are still looking at the file and can
 * fetch a better copy. Accepting everything and discovering later puts the discovery
 * after somebody has already formed an opinion from an empty inventory.
 *
 * DEDUPLICATED BY CONTENT HASH, WITHIN A CASE. The same PDF uploaded twice to the same
 * case is one document; storing it twice would let two positions cite what looks like
 * independent corroboration and is actually one file uploaded on two days.
 *
 * THAT KEY USED TO BE GLOBAL, and this note used to justify it as "two cases" rather
 * than two positions. The wider version was wrong, and opening a prepared case is what
 * proved it: the source review now arrives with the case, so the second person to open
 * the same case uploaded identical bytes and got back the FIRST person's document -
 * scoped to a case they cannot see. `forCase` returned nothing for them, and the
 * findings pointed at a document that is not on the case they were filed under. Two
 * people reading the same public FDA review are not corroborating each other; they are
 * each holding their own copy, which is the argument the caseId suffix already makes
 * one level up in server.ts.
 */

export interface StoredDocument {
  id: string;
  caseId: string;
  filename: string;
  /** SHA-256 of the bytes. The identity of the document, and what deduplicates it. */
  sha256: string;
  bytes: number;
  uploadedBy: string;
  uploadedAt: string;
  measurement: Measurement;
}

export interface Measurement {
  ok: boolean;
  verdict?: "readable" | "scanned" | "partly_scanned" | "not_a_review" | "empty" | "unreadable";
  reason: string;
  note?: string;
  pages?: number;
  characters?: number;
  charactersPerPage?: number;
  embeddedImages?: number;
  sparsePages?: number;
  toxTermHits?: number;
  liverTermHits?: number;
}

export type UploadRejection =
  | { kind: "not_a_pdf"; detail: string }
  | { kind: "too_large"; detail: string }
  | { kind: "unreadable"; detail: string; measurement: Measurement };

export type UploadResult =
  | { ok: true; document: StoredDocument; duplicateOf?: string }
  | { ok: false; rejection: UploadRejection };

/** 80 MB. The largest regulatory review collected so far is 8.5 MB, so this is an
 *  order of magnitude of headroom rather than a guess, and it exists to stop one
 *  request exhausting the disk rather than to express an opinion about documents. */
export const MAX_BYTES = 80 * 1024 * 1024;

/** Checked on the BYTES, not on the filename. An extension is a claim by the
 *  uploader; the header is a property of the file.
 *
 *  EXPORTED so `supabase-documents.ts` shares this exact test rather than carrying its
 *  own copy. Two spellings of "is this a PDF" is two answers to the question of what the
 *  product accepts, and they would diverge the first time either was touched - with the
 *  effect that whether a file is admitted depends on which store happens to be
 *  configured, which is not a difference a deployment choice should be able to make. */
export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.length > 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

/**
 * The last JSON object printed on stdout, or null.
 *
 * `JSON.parse(stdout)` was the whole of this, and it assumed the Python process emits
 * nothing but its own result. That assumption broke in the worst possible way: PyMuPDF
 * 1.26 began printing a deprecation banner to STDOUT on `import fitz`, so the parse threw
 * on every document and `measurePdf` reported every upload as unreadable - not one class
 * of PDF, all of them, with a message about the measurer rather than the file.
 *
 * The import is fixed at the source. This exists because that class of failure should not
 * be able to happen again: any library in the chain may decide to print, and a scraper
 * that finds the payload is a two-line function where "stdout is exactly my JSON" is a
 * contract nobody can enforce.
 *
 * The LAST object rather than the first, because a warning is a preamble and the result
 * is what the script exits having printed.
 */
export function lastJsonObject(stdout: string): unknown {
  for (let i = stdout.lastIndexOf("{"); i !== -1; i = stdout.lastIndexOf("{", i - 1)) {
    try {
      return JSON.parse(stdout.slice(i, stdout.lastIndexOf("}") + 1));
    } catch {
      // Not the start of the payload. Keep walking back.
    }
  }
  return null;
}

export function measurePdf(path: string, python = process.env["PYTHON"] ?? "python"): Measurement {
  try {
    const out = execFileSync(python, ["data/prep/measure_pdf.py", path], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120_000,
    });
    const parsed = lastJsonObject(out);
    if (parsed === null) {
      throw new Error(`the measurer printed no JSON. It said: ${out.trim().slice(0, 300)}`);
    }
    return parsed as Measurement;
  } catch (e) {
    // A measurement that could not run is NOT a pass. Treating a crashed measurer as
    // "probably fine" is how an unreadable document gets in on the one day the
    // toolchain is broken.
    return {
      ok: false,
      verdict: "unreadable",
      reason: `The document could not be measured, so it is not accepted. ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * The dedup key: content hash SCOPED TO A CASE.
 *
 * Collapsing identical bytes is right inside one case - re-sending a file you already
 * sent must not become a second document that a second position can cite. Across cases
 * it is wrong, and the reason is the same one that put the opener's id in a prepared
 * case's identifier: two people working the same public review are each holding their
 * own copy, not sharing a room. Keyed globally, the second case's upload returned the
 * FIRST case's document - so `forCase` found nothing for it, and a finding pointing at
 * that id named a document that is not on the case it was filed under.
 *
 * A null byte separates the halves because neither a caseId nor a hex digest can
 * contain one, so no pair of values can collide by concatenation.
 */
const hashKey = (caseId: string, sha256: string): string => `${caseId}\u0000${sha256}`;

/**
 * What the server needs from a document store, and therefore what the two
 * implementations have to agree on.
 *
 * NARROWER THAN `DocumentStore`, ON PURPOSE. `pathFor` is not here, and its absence is
 * the whole reason this interface is written down: the file store can answer it by
 * joining two strings, and `SupabaseDocumentStore` can only answer it by downloading an
 * entire object to a temp file it would then never delete. Rather than let both stores
 * carry a method one of them cannot honestly implement, the shared contract is the set
 * the server actually calls - and `streamFor` is the member that replaced it.
 *
 * A store may of course have more; this is a floor, not a ceiling.
 */
export interface DocumentStoreApi {
  upload(input: { caseId: string; filename: string; bytes: Buffer; uploadedBy: string; at: string }): Promise<UploadResult>;
  forCase(caseId: string): Promise<StoredDocument[]>;
  get(id: string): Promise<StoredDocument | null>;
  streamFor(id: string): Promise<Readable | null>;
  textFor(id: string, python?: string): Promise<{ page: number; text: string }[]>;
}

export class DocumentStore implements DocumentStoreApi {
  private docs = new Map<string, StoredDocument>();
  private byHash = new Map<string, string>();

  /** Loaded by `open`, not by the constructor - see `FileStore` in store.ts for the
   *  argument. It bites hardest here: an index that arrives a tick late is a store
   *  that has forgotten every document it holds, so the next upload of an existing
   *  file misses the dedup key and becomes a SECOND record of the same bytes, which
   *  is precisely the thing this store's content hash exists to prevent. */
  private constructor(private readonly root: string) {}

  static async open(root: string): Promise<DocumentStore> {
    const store = new DocumentStore(root);
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const index = join(this.root, "index.json");
    if (existsSync(index)) {
      for (const d of JSON.parse(await readFile(index, "utf8")) as StoredDocument[]) {
        this.docs.set(d.id, d);
        this.byHash.set(hashKey(d.caseId, d.sha256), d.id);
      }
    }
  }

  /** Synchronous inside async callers, as everywhere else in this layer: it rewrites
   *  the whole index, and the write that loses a race is as likely to be the one
   *  holding the new document as the old. */
  private persist(): void {
    writeFileSync(join(this.root, "index.json"), JSON.stringify([...this.docs.values()], null, 2), "utf8");
  }

  /**
   * Where the bytes are, as a filesystem path.
   *
   * Asynchronous although this implementation only joins two strings, because the
   * Storage-backed implementation cannot answer it without a download: `measurePdf`
   * and `textFor` shell out to Python with a PATH, and a Python script cannot be
   * handed an object in a bucket. Leaving this one method synchronous would have made
   * it the single call site that blocks the whole migration.
   */
  async pathFor(id: string): Promise<string> {
    return join(this.root, `${id}.pdf`);
  }

  /**
   * The document's bytes, as a stream, or null if they are not there.
   *
   * THE SERVING PATH USES THIS AND NOT `pathFor`, and the distinction is what keeps the
   * two stores interchangeable. `pathFor` is answerable here by joining two strings and
   * is answerable in the Storage-backed store only by downloading the whole object to
   * disk - so a serving path built on `pathFor` would have written an 80 MB temp file per
   * document VIEW and never deleted it. That store's `pathFor` throws for exactly this
   * reason; this is the method both can honestly implement.
   *
   * A STREAM, NOT A BUFFER. The reader turns pages in documents of a few hundred pages,
   * and holding one whole in memory per concurrent viewer is how a 1 GB container dies
   * under three people reading at once.
   *
   * Null rather than a thrown error, because the caller has to distinguish "no such
   * document" from "the record exists and its bytes do not" BEFORE it commits a status
   * line - once a 200 has gone out there is no taking it back.
   */
  async streamFor(id: string): Promise<Readable | null> {
    const path = await this.pathFor(id);
    if (!existsSync(path)) return null;
    return createReadStream(path);
  }

  async upload(input: { caseId: string; filename: string; bytes: Buffer; uploadedBy: string; at: string }): Promise<UploadResult> {
    if (input.bytes.length > MAX_BYTES) {
      return { ok: false, rejection: { kind: "too_large", detail: `That file is ${(input.bytes.length / 1e6).toFixed(1)} MB. The limit is ${MAX_BYTES / 1e6} MB.` } };
    }
    if (!looksLikePdf(input.bytes)) {
      return { ok: false, rejection: { kind: "not_a_pdf", detail: "That file does not start with a PDF header, whatever it is named." } };
    }

    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const existingId = this.byHash.get(hashKey(input.caseId, sha256));
    if (existingId !== undefined) {
      // Same bytes, already on THIS case. Returned as a success with the original
      // attached, because re-uploading a file you already sent is not an error - but
      // it must not become a second document that a second position can cite.
      return { ok: true, document: this.docs.get(existingId)!, duplicateOf: existingId };
    }

    const id = `doc_${randomBytes(9).toString("hex")}`;
    const path = await this.pathFor(id);
    writeFileSync(path, input.bytes);

    const measurement = measurePdf(path);
    if (!measurement.ok) {
      // Written, measured, refused - and the file stays on disk rather than being
      // deleted, so the reason can be re-checked and an OCR pass can be run against
      // the exact bytes that were rejected.
      return { ok: false, rejection: { kind: "unreadable", detail: measurement.reason, measurement } };
    }

    const doc: StoredDocument = {
      id, caseId: input.caseId, filename: input.filename, sha256,
      bytes: input.bytes.length, uploadedBy: input.uploadedBy, uploadedAt: input.at,
      measurement,
    };
    this.docs.set(id, doc);
    this.byHash.set(hashKey(input.caseId, sha256), id);
    this.persist();
    return { ok: true, document: doc };
  }

  async forCase(caseId: string): Promise<StoredDocument[]> {
    return [...this.docs.values()]
      .filter((d) => d.caseId === caseId)
      .sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1));
  }

  async get(id: string): Promise<StoredDocument | null> {
    return this.docs.get(id) ?? null;
  }

  /**
   * The document's text, one entry per page, for retrieval.
   *
   * CACHED TO A SIDECAR, because extraction shells out to Python and re-running it on
   * every question would put a second or more of PyMuPDF in front of a surface people
   * are meant to use conversationally. The sidecar sits beside the PDF and is derived
   * data: deleting it costs a re-extraction and nothing else, which is why it is not
   * in the index and not in the hash chain.
   *
   * RETURNS AN EMPTY ARRAY RATHER THAN THROWING when extraction fails - a scanned
   * document, a missing PyMuPDF, a file that will not open. The caller then retrieves
   * nothing and the ask surface answers "nothing in the uploaded documents matches",
   * which is true and is the honest failure. Throwing here would turn an unreadable
   * document into a 500 and tell the reader nothing about which document it was.
   */
  async textFor(id: string, python = process.env["PYTHON"] ?? "python"): Promise<{ page: number; text: string }[]> {
    const cache = join(this.root, `${id}.pages.json`);
    if (existsSync(cache)) {
      try {
        return JSON.parse(readFileSync(cache, "utf8")) as { page: number; text: string }[];
      } catch {
        // A corrupt cache is a cache miss, not a failure. Fall through and re-extract.
      }
    }

    const path = await this.pathFor(id);
    if (!existsSync(path)) return [];

    try {
      const out = execFileSync(python, ["data/prep/extract_pdf_text.py", path], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      // Same scraper as the measurer, for the same reason: this parsed the whole of
      // stdout, so PyMuPDF's deprecation banner emptied every uploaded document's text
      // and the catch below turned that into "no pages" - a silently unsearchable file.
      const parsed = lastJsonObject(out) as { ok: boolean; pages?: { page: number; text: string }[] } | null;
      if (parsed === null) throw new Error("the extractor printed no JSON");
      // Running headers stripped before caching, exactly as the library does. Short
      // uploads are left untouched - see pages.ts for why the threshold exists.
      const pages = stripBoilerplate(parsed.ok && parsed.pages !== undefined ? parsed.pages : []);
      writeFileSync(cache, JSON.stringify(pages), "utf8");
      return pages;
    } catch {
      return [];
    }
  }
}
