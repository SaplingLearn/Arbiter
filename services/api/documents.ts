import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
 * DEDUPLICATED BY CONTENT HASH. The same PDF uploaded twice is one document. Storing
 * it twice would let two cases cite what looks like independent corroboration and is
 * actually one file uploaded on two days.
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
 *  uploader; the header is a property of the file. */
function looksLikePdf(bytes: Buffer): boolean {
  return bytes.length > 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

export function measurePdf(path: string, python = process.env["PYTHON"] ?? "python"): Measurement {
  try {
    const out = execFileSync(python, ["data/prep/measure_pdf.py", path], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120_000,
    });
    return JSON.parse(out) as Measurement;
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

export class DocumentStore {
  private docs = new Map<string, StoredDocument>();
  private byHash = new Map<string, string>();

  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
    const index = join(root, "index.json");
    if (existsSync(index)) {
      for (const d of JSON.parse(readFileSync(index, "utf8")) as StoredDocument[]) {
        this.docs.set(d.id, d);
        this.byHash.set(d.sha256, d.id);
      }
    }
  }

  private persist(): void {
    writeFileSync(join(this.root, "index.json"), JSON.stringify([...this.docs.values()], null, 2), "utf8");
  }

  pathFor(id: string): string {
    return join(this.root, `${id}.pdf`);
  }

  upload(input: { caseId: string; filename: string; bytes: Buffer; uploadedBy: string; at: string }): UploadResult {
    if (input.bytes.length > MAX_BYTES) {
      return { ok: false, rejection: { kind: "too_large", detail: `That file is ${(input.bytes.length / 1e6).toFixed(1)} MB. The limit is ${MAX_BYTES / 1e6} MB.` } };
    }
    if (!looksLikePdf(input.bytes)) {
      return { ok: false, rejection: { kind: "not_a_pdf", detail: "That file does not start with a PDF header, whatever it is named." } };
    }

    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const existingId = this.byHash.get(sha256);
    if (existingId !== undefined) {
      // Same bytes, already here. Returned as a success with the original attached,
      // because re-uploading a file you already sent is not an error - but it must
      // not become a second document that a second position can cite.
      return { ok: true, document: this.docs.get(existingId)!, duplicateOf: existingId };
    }

    const id = `doc_${randomBytes(9).toString("hex")}`;
    const path = this.pathFor(id);
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
    this.byHash.set(sha256, id);
    this.persist();
    return { ok: true, document: doc };
  }

  forCase(caseId: string): StoredDocument[] {
    return [...this.docs.values()]
      .filter((d) => d.caseId === caseId)
      .sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1));
  }

  get(id: string): StoredDocument | null {
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
  textFor(id: string, python = process.env["PYTHON"] ?? "python"): { page: number; text: string }[] {
    const cache = join(this.root, `${id}.pages.json`);
    if (existsSync(cache)) {
      try {
        return JSON.parse(readFileSync(cache, "utf8")) as { page: number; text: string }[];
      } catch {
        // A corrupt cache is a cache miss, not a failure. Fall through and re-extract.
      }
    }

    const path = this.pathFor(id);
    if (!existsSync(path)) return [];

    try {
      const out = execFileSync(python, ["data/prep/extract_pdf_text.py", path], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      const parsed = JSON.parse(out) as { ok: boolean; pages?: { page: number; text: string }[] };
      const pages = parsed.ok && parsed.pages !== undefined ? parsed.pages : [];
      writeFileSync(cache, JSON.stringify(pages), "utf8");
      return pages;
    } catch {
      return [];
    }
  }
}
