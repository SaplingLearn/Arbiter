import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Pool } from "pg";
// LOAD-BEARING EVEN WHEN A POOL IS INJECTED. Importing db.ts runs its
// `pg.types.setTypeParser` calls, and those are what make the row mapping below true:
// without them `at` arrives as a `Date` and `byte_length` as a string, and
// `StoredDocument` declares them an ISO string and a number. Neither mismatch throws -
// see the comment at the top of db.ts for what each one silently breaks. So this import
// stays even if a future refactor stops calling `pool()` here.
import { pool as sharedPool } from "./db.js";
import {
  DocumentStore, looksLikePdf, MAX_BYTES, measurePdf,
  type Measurement, type StoredDocument, type UploadResult,
} from "./documents.js";

/**
 * `DocumentStore`, with the metadata in Postgres and the bytes in Supabase Storage.
 *
 * Everything documents.ts says about WHY a document is measured before it is accepted
 * and deduplicated by content hash within a case applies here unchanged - read that file
 * first. This one only explains what changes when the bytes stop being a file.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * THE PYTHON SCRIPTS STILL NEED A REAL FILE, AND THAT IS THIS CLASS'S WHOLE PROBLEM.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * `measure_pdf.py` and `extract_pdf_text.py` take a filesystem path. An object in a
 * bucket is not one, so every call into them here is: materialise a temp file, run the
 * script, delete the temp file. The delete is in a `finally` and it removes the whole
 * directory, not the file it wrote, because the extractor drops a sidecar beside the PDF
 * and deleting only the PDF would leave that behind.
 *
 * A LEAK HERE IS NOT UNTIDY, IT IS AN OUTAGE. `MAX_BYTES` is 80 MB and the deployment
 * target is a container with no volume, so its filesystem is the image's overlay and a
 * few gigabytes total. One retained temp file per upload fills it in tens of uploads,
 * and when it fills, nothing that writes works: not the uploads, not the logs, not the
 * next deploy's unpack. That is why the cleanup is in a single helper used by every path
 * rather than at each call site where one `return` could step over it.
 *
 * WHAT DIVERGES FROM `DocumentStore`, deliberately, each noted at its own site:
 *   - a refused document's bytes are NOT retained (`upload`)
 *   - `pathFor` throws instead of handing back a path (see the method)
 *   - the extracted-text cache is an object in the bucket, not a sidecar on disk
 */

/** The one place the storage layout is decided. Flat, and keyed on the document id
 *  rather than on `${caseId}/…`: a caseId is partly user-supplied text - server.ts
 *  builds a prepared case's id as `${loaded.caseId}--${user.id}` - and a Storage key has
 *  a character set. One case whose id contains a character the bucket rejects would fail
 *  every upload on that case and nothing else, which is the hardest kind of bug to
 *  reproduce. `doc_<18 hex>` cannot contain one. The case is on the row, which is the
 *  index anyway, and `storage_key` is stored per row - so this layout can change later
 *  without stranding the documents written under the old one. */
const storageKeyFor = (id: string): string => `${id}.pdf`;

/** The extracted-text cache, beside its PDF in the bucket. See `textFor`. */
const pagesKeyFor = (storageKey: string): string => `${storageKey}.pages.json`;

/** Exported so the test can look for strays by name. Everything this store writes to
 *  the filesystem lives under a directory with this prefix, so "did anything leak?" is a
 *  question the filesystem can answer. */
export const TEMP_PREFIX = "arbiter-doc-";

/**
 * Materialise `bytes` as `<temp dir>/<id>.pdf`, run `fn` against it, and delete the
 * directory whichever way `fn` ends.
 *
 * THE DIRECTORY, NOT THE FILE. `DocumentStore.textFor` writes `<id>.pages.json` next to
 * the PDF it read, so a cleanup that named the PDF would leave the sidecar - smaller
 * than 80 MB, permanent, and invisible because nothing ever lists /tmp.
 *
 * A FRESH DIRECTORY PER CALL, from `mkdtemp`, so two concurrent uploads cannot write the
 * same path and cannot delete each other's file. Ids are random enough that a collision
 * is not the real risk; a second call for the SAME id is - `textFor` on one document
 * from two requests at once - and that one is not a hypothetical.
 *
 * `force: true` makes the only expected failure - the directory is already gone - a
 * no-op rather than a throw that would replace whatever `fn` threw.
 */
async function withTempPdf<T>(id: string, bytes: Buffer, fn: (path: string, dir: string) => Promise<T> | T): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  try {
    const path = join(dir, `${id}.pdf`);
    await writeFile(path, bytes);
    return await fn(path, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Postgres' unique_violation. The `unique (case_id, sha256)` constraint reaching this
 *  code is not an error condition; see the insert in `upload`. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** The `documents` row, named as Postgres names it. `at` is a string and `byte_length` a
 *  number only because db.ts installed the parsers - see the import comment. */
interface DocumentRow {
  id: string;
  case_id: string;
  filename: string;
  uploaded_by: string;
  at: string;
  byte_length: number;
  sha256: string;
  storage_key: string;
  measurement: Measurement | null;
}

const COLUMNS = "id, case_id, filename, uploaded_by, at, byte_length, sha256, storage_key, measurement";

/**
 * A row with no measurement is a row this store did not write - every insert here
 * carries one, because an upload whose measurement is not `ok` never reaches the insert.
 * The column is nullable because the contract made it nullable, not because a null means
 * anything.
 *
 * MAPPED TO A REFUSAL, not to a pass. `measurePdf` already decided that a measurement
 * which could not run is not a pass; a measurement that was never recorded is the same
 * claim with less evidence behind it. Reporting `ok: true` here would let a document
 * nobody measured sit in the inventory looking exactly like one that cleared the gate.
 */
function measurementOf(row: DocumentRow): Measurement {
  return row.measurement ?? {
    ok: false,
    verdict: "unreadable",
    reason: "This document is stored without a measurement, so there is no record that it was ever readable.",
  };
}

const toDocument = (row: DocumentRow): StoredDocument => ({
  id: row.id,
  caseId: row.case_id,
  filename: row.filename,
  sha256: row.sha256,
  bytes: row.byte_length,
  uploadedBy: row.uploaded_by,
  uploadedAt: row.at,
  measurement: measurementOf(row),
});

/** Storage config, read once. The service-role key is server-side only - it bypasses RLS
 *  - which is why the contract forbids a `VITE_` name for it: a `VITE_` variable is
 *  compiled into the browser bundle. */
export function storageClientFrom(env: NodeJS.ProcessEnv = process.env): SupabaseClient {
  const url = env["SUPABASE_URL"];
  const key = env["SUPABASE_SERVICE_ROLE_KEY"];
  if (url === undefined || url.trim() === "" || key === undefined || key.trim() === "") {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the Storage-backed document store.");
  }
  // BOTH AUTH FLAGS OFF. This client is used for Storage and nothing else, under a
  // service-role key that never expires within a process lifetime. Left on,
  // `autoRefreshToken` installs a repeating timer, and a timer with no `unref` keeps
  // Node's event loop alive - a test suite that builds one of these never exits, and the
  // failure looks like a hung test rather than a stray client.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function bucketFrom(env: NodeJS.ProcessEnv = process.env): string {
  return env["SUPABASE_BUCKET"] ?? "documents";
}

export interface SupabaseDocumentStoreOptions {
  /** Defaults to the process-wide pool from db.ts. Injected by tests, which run against
   *  their own database rather than the one `DATABASE_URL` names. */
  pool?: Pool;
  storage?: SupabaseClient;
  bucket?: string;
  env?: NodeJS.ProcessEnv;
}

export class SupabaseDocumentStore {
  private constructor(
    private readonly db: Pool,
    private readonly supabase: SupabaseClient,
    private readonly bucket: string,
  ) {}

  /**
   * Async and doing nothing asynchronous, matching `DocumentStore.open`.
   *
   * There is no index to load - the database is the index, which is the point - and the
   * bucket is deliberately NOT created here. Creating infrastructure as a side effect of
   * opening a store means a typo in `SUPABASE_BUCKET` silently provisions a second empty
   * bucket and the documents appear to have vanished; a missing bucket instead fails the
   * first upload with Storage's own "Bucket not found", which names the problem.
   */
  static async open(options: SupabaseDocumentStoreOptions = {}): Promise<SupabaseDocumentStore> {
    const env = options.env ?? process.env;
    return new SupabaseDocumentStore(
      options.pool ?? sharedPool(),
      options.storage ?? storageClientFrom(env),
      options.bucket ?? bucketFrom(env),
    );
  }

  private files(): ReturnType<SupabaseClient["storage"]["from"]> {
    return this.supabase.storage.from(this.bucket);
  }

  /**
   * THROWS, ON PURPOSE, AND IT IS THE ONE PLACE THIS STORE REFUSES TO IMITATE THE OTHER.
   *
   * `DocumentStore.pathFor` returns the document's permanent home: the caller may stat
   * it, stream it, and come back to it tomorrow. Storage has no such path. The only
   * thing this store could return is a temp file it just downloaded - and then nobody
   * owns deleting it. `server.ts` calls `pathFor` on every raw-document request and
   * hands the result to `existsSync` and `createReadStream`; a temp path satisfies both,
   * so every one of those requests would succeed, and every one would leave up to 80 MB
   * behind on a container with a few gigabytes of writable overlay. It would work in
   * review, work in staging, and fill the disk in production on the day the case that
   * people actually read arrives.
   *
   * So the failure is moved to the first call instead of the disk-full: `streamFor` for
   * serving the document, `withLocalFile` for anything that genuinely needs a file on
   * disk. Both make the lifetime somebody's explicit responsibility.
   */
  async pathFor(id: string): Promise<string> {
    throw new Error(
      `Documents are in Supabase Storage, so ${id} has no filesystem path. Use streamFor(id) to serve the document, or withLocalFile(id, fn) if a real file is needed - withLocalFile deletes it afterwards.`,
    );
  }

  /**
   * The document's bytes as a stream, or null if there is nothing to serve.
   *
   * NULL BEFORE A BYTE IS WRITTEN, WHICH IS THE POINT OF RETURNING IT AT ALL. `server.ts`
   * resolves the document before `writeHead`, deliberately: once a 200 and a
   * content-length have gone out there is no way to turn the response into a clean error,
   * and the reader gets a truncated PDF instead of a message. So a missing object has to
   * be answerable while the status line is still unwritten. Null covers a Storage error as
   * well as an absent object - the same thing `existsSync` could say about the file.
   *
   * `.asStream()`, NOT `download()` THEN `.stream()`, AND THE DIFFERENCE IS THE WHOLE
   * REASON THIS METHOD EXISTS. `BlobDownloadBuilder` resolves by calling `await
   * response.blob()`, so by the time a Blob exists the entire object is already in memory;
   * `Blob.stream()` then streams out of that buffer and has saved nothing. A 264-page
   * review would sit in the heap once per concurrent view, on a 1 GB container that
   * already carries an 80 MB upload buffer. `.asStream()` hands back `response.body`
   * untouched, so the bytes go socket-to-socket and the process holds one chunk at a time.
   *
   * THE CALLER OWNS THE STREAM. Unlike `withLocalFile` there is nothing on disk to clean
   * up, but an un-consumed, un-destroyed stream holds its HTTP connection open. `server.ts`
   * pipes it and destroys the response on error, which covers both ends.
   */
  async streamFor(id: string): Promise<Readable | null> {
    const row = await this.rowById(id);
    if (row === null) return null;
    const { data, error } = await this.files().download(row.storage_key).asStream();
    if (error !== null || data === null) return null;
    return Readable.fromWeb(data as WebReadableStream<Uint8Array>);
  }

  /**
   * Run `fn` against a real file holding this document's bytes, and delete it afterwards
   * however `fn` ends. The replacement for `pathFor` wherever a filesystem path is what
   * is actually needed - it is what `textFor` uses to reach PyMuPDF.
   *
   * Throws if the document or its object is missing, because a caller that asked for a
   * file cannot be handed the absence of one.
   */
  async withLocalFile<T>(id: string, fn: (path: string) => Promise<T> | T): Promise<T> {
    const row = await this.rowById(id);
    if (row === null) throw new Error(`No such document: ${id}`);
    const bytes = await this.download(row.storage_key);
    if (bytes === null) throw new Error(`Document ${id} has a record but its bytes are not in the ${this.bucket} bucket.`);
    return withTempPdf(id, bytes, (path) => fn(path));
  }

  async upload(input: { caseId: string; filename: string; bytes: Buffer; uploadedBy: string; at: string }): Promise<UploadResult> {
    if (input.bytes.length > MAX_BYTES) {
      return { ok: false, rejection: { kind: "too_large", detail: `That file is ${(input.bytes.length / 1e6).toFixed(1)} MB. The limit is ${MAX_BYTES / 1e6} MB.` } };
    }
    if (!looksLikePdf(input.bytes)) {
      return { ok: false, rejection: { kind: "not_a_pdf", detail: "That file does not start with a PDF header, whatever it is named." } };
    }

    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const existing = await this.byHash(input.caseId, sha256);
    if (existing !== null) {
      // Same bytes, already on this case. Success with the original attached, exactly as
      // the file store answers it.
      return { ok: true, document: existing, duplicateOf: existing.id };
    }

    const id = `doc_${randomBytes(9).toString("hex")}`;
    const measurement = await withTempPdf(id, input.bytes, (path) => measurePdf(path));
    if (!measurement.ok) {
      // MEASURED BEFORE ANYTHING IS UPLOADED, which is why the temp file above holds the
      // bytes rather than the bucket. The file store keeps a refused document on disk so
      // its bytes can be re-checked; here the equivalent would be an object with no row
      // pointing at it - unreachable through any code path, never cleaned up, and 80 MB
      // of a bucket per refusal. The measurement travels back with the refusal, which is
      // what the uploader is actually shown, and the bytes are still on their machine.
      return { ok: false, rejection: { kind: "unreadable", detail: measurement.reason, measurement } };
    }

    const storageKey = storageKeyFor(id);
    // `upsert: false`: the id is fresh, so a collision means something is wrong and an
    // error is a better answer than silently overwriting another document's bytes.
    const put = await this.files().upload(storageKey, input.bytes, { contentType: "application/pdf", upsert: false });
    if (put.error !== null) {
      throw new Error(`Could not store the document bytes in the ${this.bucket} bucket: ${put.error.message}`);
    }

    try {
      const { rows } = await this.db.query<DocumentRow>(
        `insert into documents (id, case_id, filename, uploaded_by, at, byte_length, sha256, storage_key, measurement)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${COLUMNS}`,
        [id, input.caseId, input.filename, input.uploadedBy, input.at, input.bytes.length, sha256, storageKey, JSON.stringify(measurement)],
      );
      return { ok: true, document: toDocument(rows[0]!) };
    } catch (e) {
      // THE UNIQUE CONSTRAINT IS THE DEDUP, AND THIS IS THE PATH WHERE IT DOES THE WORK.
      // The `byHash` lookup above is a check-then-insert, and between the two a second
      // request carrying the same bytes can insert first. In one process the file store
      // cannot interleave there; across connections this can, which is exactly what the
      // migration's `unique (case_id, sha256)` comment says it is for. So the loser reads
      // back the winner's row and answers as a duplicate - the same answer it would have
      // given had it lost the race by a millisecond more.
      await this.discard(storageKey);
      if (isUniqueViolation(e)) {
        const winner = await this.byHash(input.caseId, sha256);
        if (winner !== null) return { ok: true, document: winner, duplicateOf: winner.id };
      }
      throw e;
    }
  }

  async forCase(caseId: string): Promise<StoredDocument[]> {
    // `at, id` rather than `at` alone. The file store sorts an array by `uploadedAt` and
    // leaves ties in insertion order; Postgres leaves ties in whatever order it read the
    // rows, which can change between runs of the same query. Neither order is meaningful
    // for two documents uploaded in the same millisecond - but one of them is repeatable,
    // and a list that reshuffles itself under the reader is worse than an arbitrary one.
    const { rows } = await this.db.query<DocumentRow>(
      `select ${COLUMNS} from documents where case_id = $1 order by at, id`, [caseId],
    );
    return rows.map(toDocument);
  }

  async get(id: string): Promise<StoredDocument | null> {
    const row = await this.rowById(id);
    return row === null ? null : toDocument(row);
  }

  /**
   * The document's text, one entry per page.
   *
   * THE EXTRACTION IS `DocumentStore`'s, RUN OVER THE TEMP FILE, not a copy of it. The
   * logic that matters is not the `execFileSync` line - it is `lastJsonObject` scraping
   * PyMuPDF's deprecation banner off stdout, `stripBoilerplate` removing running headers
   * before the text is cached, and returning `[]` rather than throwing when extraction
   * fails. Reimplementing those three would be four lines of copy that can drift, and the
   * drift is silent in both directions: a store that throws where the other returns `[]`
   * turns an unreadable document into a 500, and a store that skips `stripBoilerplate`
   * returns text that retrieval scores differently for no reason a reader can see. So
   * this opens a throwaway `DocumentStore` over the temp directory and asks it. It is an
   * odd-looking three lines that cannot fall out of step.
   *
   * KEPT DELIBERATELY, not left pending a tidier signature. Lifting the body out of
   * `DocumentStore.textFor` into a shared `extractPages(path, python)` was considered and
   * rejected on review: it reads better and it buys nothing, because the exact behaviour
   * this needs is already a method and calling it is the only version that cannot be
   * half-copied.
   *
   * CACHED IN THE BUCKET, beside the PDF. documents.ts caches to a sidecar because
   * extraction shells out to Python and `server.ts` calls `textFor` for every document on
   * a case on every question asked. Here the temp file is deleted at the end of the call,
   * so without a cache each question re-downloads and re-runs PyMuPDF over every document
   * - which is the conversational surface paying seconds per turn. The sidecar is derived
   * data: losing it costs a re-extraction and nothing else.
   */
  async textFor(id: string, python = process.env["PYTHON"] ?? "python"): Promise<{ page: number; text: string }[]> {
    const row = await this.rowById(id);
    if (row === null) return [];

    const cached = await this.cachedPages(row.storage_key);
    if (cached !== null) return cached;

    const bytes = await this.download(row.storage_key);
    // Mirrors `if (!existsSync(path)) return []` in the file store: a record whose bytes
    // are gone retrieves nothing, and the ask surface says nothing matched, which is true.
    if (bytes === null) return [];

    const pages = await withTempPdf(id, bytes, async (_path, dir) => {
      const local = await DocumentStore.open(dir);
      return local.textFor(id, python);
    });

    // EMPTY RESULTS ARE NOT CACHED. `[]` means either a document with no extractable
    // text - which cannot be here, since an unreadable document is refused at upload -
    // or a toolchain that is broken right now: no PyMuPDF, a killed child process. The
    // second is transient, and caching it makes a document permanently unsearchable long
    // after the interpreter is fixed, with nothing to point at as the cause.
    if (pages.length > 0) await this.cachePages(row.storage_key, pages);
    return pages;
  }

  // ---- Postgres and Storage, one helper each -------------------------------------

  private async rowById(id: string): Promise<DocumentRow | null> {
    const { rows } = await this.db.query<DocumentRow>(`select ${COLUMNS} from documents where id = $1`, [id]);
    return rows[0] ?? null;
  }

  /** The dedup lookup, keyed on `(caseId, sha256)` - the same key `DocumentStore.byHash`
   *  uses, and the same key the table's unique constraint holds. Scoped to the case: see
   *  the long note in documents.ts for why the global version was wrong. */
  private async byHash(caseId: string, sha256: string): Promise<StoredDocument | null> {
    const { rows } = await this.db.query<DocumentRow>(
      `select ${COLUMNS} from documents where case_id = $1 and sha256 = $2`, [caseId, sha256],
    );
    return rows[0] === undefined ? null : toDocument(rows[0]);
  }

  private async download(key: string): Promise<Buffer | null> {
    const { data, error } = await this.files().download(key);
    if (error !== null || data === null) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  /** Removes an object whose row does not exist. Failures are swallowed because this only
   *  ever runs while another error is on its way to the caller, and replacing that error
   *  with a cleanup error would report the symptom instead of the cause. */
  private async discard(key: string): Promise<void> {
    try {
      await this.files().remove([key]);
    } catch {
      // Orphaned object. The insert that failed is the story; this is the footnote.
    }
  }

  private async cachedPages(storageKey: string): Promise<{ page: number; text: string }[] | null> {
    const raw = await this.download(pagesKeyFor(storageKey));
    if (raw === null) return null;
    try {
      return JSON.parse(raw.toString("utf8")) as { page: number; text: string }[];
    } catch {
      // A corrupt cache is a cache miss, not a failure - same as the file store.
      return null;
    }
  }

  private async cachePages(storageKey: string, pages: { page: number; text: string }[]): Promise<void> {
    // `upsert: true`, unlike the PDF: this object is rewritten whenever the cache is
    // missed, and a re-extraction failing to overwrite its own stale cache would be the
    // one write here that must not error.
    //
    // The result is deliberately not inspected. This is derived data: a cache that could
    // not be written costs the next caller an extraction, while throwing over it would
    // cost this caller the text it already has in hand.
    await this.files().upload(
      pagesKeyFor(storageKey), Buffer.from(JSON.stringify(pages), "utf8"),
      { contentType: "application/json", upsert: true },
    );
  }
}
