import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocumentStore, MAX_BYTES, type StoredDocument, type UploadResult } from "../documents.js";
import { SupabaseDocumentStore, TEMP_PREFIX } from "../supabase-documents.js";

/**
 * AGAINST THE REAL STACK, OR NOT AT ALL.
 *
 * There is no mock in this file, and the reason is what this store actually is. Almost
 * none of its behaviour lives in its own code: the dedup is a unique constraint in
 * Postgres, `bytes` being a number rather than a string is a `pg` type parser, the
 * uploaded object being byte-identical on the way back is Supabase Storage, and the
 * measurement gate is a Python process reading a real file. A mock of any of those is a
 * restatement of what this file already assumes and would pass just as happily if the
 * assumption were wrong - which is precisely the failure mode db.ts's header describes,
 * where the wrong answer arrives with no error attached.
 *
 * SKIPPED, NOT FAILED, WITHOUT A STACK. CI has no database and no Storage, and the
 * contract is explicit that the product must keep working there on the file stores. A
 * suite that goes red on a laptop with no podman running would push somebody to weaken
 * the store rather than start the stack.
 */

const asSet = (v: string | undefined): string | null => (v === undefined || v.trim() === "" ? null : v);

const ADMIN_URL = asSet(process.env["DATABASE_URL"]);
const SUPABASE_URL = asSet(process.env["SUPABASE_URL"]);
const SERVICE_KEY = asSet(process.env["SUPABASE_SERVICE_ROLE_KEY"]);
const LIVE = ADMIN_URL !== null && SUPABASE_URL !== null && SERVICE_KEY !== null;

/**
 * ITS OWN DATABASE AND ITS OWN BUCKET, both named for this suite.
 *
 * Three agents share one local stack, and the migration in `supabase/migrations` is not
 * idempotent by design - it has no `if not exists` anywhere. So a suite that applied it
 * to `postgres` would either fail on the second run or destroy whatever the other two
 * are holding. Dropped and recreated at the start rather than merely created, so the run
 * says the same thing whether or not the previous one finished.
 */
/**
 * PER-PROCESS, NOT FIXED NAMES, for both the database and the bucket. A constant name is
 * enough for one `npm test` at a time and fails the moment two overlap - the second run
 * drops the database, or empties the bucket, that the first is mid-suite inside, and the
 * first fails with objects it never wrote. Reproduced on this branch while several agents
 * ran the suite at once. The bucket matters as much as the database here: emptying it is
 * how this suite makes itself repeatable, so a shared one is a shared truncation.
 */
const TEST_DB = `arbiter_test_docs_${process.pid}`;
const BUCKET = `arbiter-test-documents-${process.pid}`;

const testUrl = (): string => {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
};

const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** `id` is random per store, so it is the one field two stores holding the same document
 *  cannot agree on. Everything else must match exactly - and the fields are written out
 *  rather than spread so that adding one to `StoredDocument` fails to compile here
 *  instead of quietly dropping out of the comparison. */
const withoutId = (
  { caseId, filename, sha256, bytes, uploadedBy, uploadedAt, measurement }: StoredDocument,
): Omit<StoredDocument, "id"> => ({ caseId, filename, sha256, bytes, uploadedBy, uploadedAt, measurement });

function accepted(r: UploadResult): StoredDocument {
  if (!r.ok) throw new Error(`upload was refused: ${r.rejection.kind} - ${r.rejection.detail}`);
  return r.document;
}

/** Every temp directory this store makes carries `TEMP_PREFIX`, so the filesystem itself
 *  answers "did that call leak?". Compared before and against after rather than against
 *  an empty list: a directory left by an earlier crashed run is not this test's failure,
 *  and asserting `[]` would make it look like one. */
const strays = async (): Promise<string[]> =>
  (await readdir(tmpdir())).filter((n) => n.startsWith(TEMP_PREFIX)).sort();

describe.skipIf(!LIVE)("SupabaseDocumentStore, against a live Postgres and Storage", { timeout: 60_000 }, () => {
  let pool: pg.Pool;
  let storage: SupabaseClient;
  let store: SupabaseDocumentStore;
  let files: DocumentStore;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL! });
    await admin.connect();
    // `with (force)` terminates any connection still attached from a previous run. Without
    // it a leaked pool from an interrupted run makes the drop hang rather than fail, and
    // the suite times out in a hook with nothing to point at.
    await admin.query(`drop database if exists ${TEST_DB} with (force)`);
    await admin.query(`create database ${TEST_DB}`);
    await admin.end();

    pool = new pg.Pool({ connectionString: testUrl() });
    // Read and executed through `pg` rather than piped into psql: there is no shell
    // redirect available here, and `pg`'s simple query protocol runs a multi-statement
    // string as one batch - which is what the migration is. Resolved against this file
    // rather than the working directory so it does not depend on where vitest was started.
    const migration = await readFile(new URL("../../../supabase/migrations/0001_init.sql", import.meta.url), "utf8");
    await pool.query(migration);

    storage = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    // The bucket may already exist from a previous run; its contents may not survive into
    // this one. `createBucket` answering "Duplicate" is the expected case, so the error
    // that matters is `emptyBucket`'s - if the bucket is not there after this, nothing
    // below can pass and the reason should be the first thing reported.
    await storage.storage.createBucket(BUCKET, { public: false });
    const emptied = await storage.storage.emptyBucket(BUCKET);
    if (emptied.error !== null) throw new Error(`could not empty the ${BUCKET} bucket: ${emptied.error.message}`);

    store = await SupabaseDocumentStore.open({ pool, storage, bucket: BUCKET });
    // The store to compare against, on a throwaway directory. Both are handed the same
    // input in the parity test, and both run the same measurer over it.
    files = await DocumentStore.open(mkdtempSync(join(tmpdir(), "arbiter-file-docs-")));
  }, 120_000);

  afterAll(async () => {
    // An open pool keeps the event loop alive and the suite never exits - the same
    // reason db.ts carries `closePool`.
    await pool.end();

    // CLEANED UP AT THE END, not only reset at the start, and that became necessary when
    // the names gained a pid. A fixed name is self-cleaning: the next run drops and
    // recreates the same database and empties the same bucket. Per-process names are not
    // - every run would leave its own database and its own bucket behind, so a developer
    // who runs the suite a few times a day accumulates them indefinitely on the local
    // stack. Best-effort: a failure here is not a test failure, because the run itself
    // already passed or failed on its own merits and masking that with a cleanup error
    // would be strictly worse than a stray database.
    try {
      await storage.storage.emptyBucket(BUCKET);
      await storage.storage.deleteBucket(BUCKET);
      const admin = new pg.Client({ connectionString: ADMIN_URL! });
      await admin.connect();
      await admin.query(`drop database if exists ${TEST_DB} with (force)`);
      await admin.end();
    } catch {
      // Left behind. The next run with this pid drops it anyway.
    }
  });

  const bucketKeys = async (): Promise<string[]> => {
    const { data, error } = await storage.storage.from(BUCKET).list("", { limit: 1000 });
    if (error !== null) throw error;
    return (data ?? []).map((o) => o.name).sort();
  };

  const rowCount = async (caseId: string): Promise<number> => {
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from documents where case_id = $1", [caseId],
    );
    return rows[0]!.n;
  };

  it("puts the bytes in Storage and the metadata in Postgres", async () => {
    const bytes = readablePdfBytes("storage-round-trip");
    const at = "2026-08-16T10:00:00.000Z";
    const doc = accepted(await store.upload({
      caseId: "case-storage", filename: "review.pdf", bytes, uploadedBy: "ann", at,
    }));

    const { rows } = await pool.query<{
      case_id: string; filename: string; uploaded_by: string; at: string;
      byte_length: number; sha256: string; storage_key: string; measurement: { ok: boolean } | null;
    }>("select * from documents where id = $1", [doc.id]);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.case_id).toBe("case-storage");
    expect(row.filename).toBe("review.pdf");
    expect(row.uploaded_by).toBe("ann");
    expect(row.sha256).toBe(sha(bytes));
    expect(row.measurement?.ok).toBe(true);

    // THE TWO db.ts PARSERS, ASSERTED AS TYPES AND NOT ONLY AS VALUES. Both of these
    // pass `toBe` comparisons that look fine while being the wrong JavaScript type:
    // `byte_length` comes back as the string "3231" without the int8 parser, and
    // `at` as a `Date` without the timestamptz one. The second is the dangerous shape -
    // `Date.parse` of a Date is NaN and every comparison against NaN is false.
    expect(typeof row.byte_length).toBe("number");
    expect(row.byte_length).toBe(bytes.length);
    expect(typeof row.at).toBe("string");
    expect(row.at).toBe(at);
    expect(doc.uploadedAt).toBe(at);
    expect(doc.bytes).toBe(bytes.length);

    const got = await storage.storage.from(BUCKET).download(row.storage_key);
    expect(got.error).toBeNull();
    const stored = Buffer.from(await got.data!.arrayBuffer());
    // Byte-identical, checked by hash rather than by length: a truncated or re-encoded
    // upload has the right length far more often than it has the right digest.
    expect(sha(stored)).toBe(sha(bytes));
  });

  it("round-trips get and forCase identically to DocumentStore for the same input", async () => {
    const caseId = "case-parity";
    const inputs = [
      { caseId, filename: "first.pdf", bytes: readablePdfBytes("parity-a"), uploadedBy: "ann", at: "2026-08-16T10:00:00.000Z" },
      { caseId, filename: "second.pdf", bytes: readablePdfBytes("parity-b"), uploadedBy: "bea", at: "2026-08-16T11:00:00.000Z" },
    ];

    const mine: StoredDocument[] = [];
    const theirs: StoredDocument[] = [];
    for (const input of inputs) {
      mine.push(accepted(await store.upload(input)));
      theirs.push(accepted(await files.upload(input)));
    }

    // Field for field, INCLUDING the measurement. The measurement is a jsonb round trip
    // in one store and an in-memory object in the other, and it is what the uploader is
    // shown when a document is refused - so a key lost in the column is a refusal that
    // stops explaining itself.
    expect(mine.map(withoutId)).toEqual(theirs.map(withoutId));

    expect(withoutId((await store.get(mine[0]!.id))!)).toEqual(withoutId((await files.get(theirs[0]!.id))!));
    expect(await store.get("doc_does_not_exist")).toBeNull();

    expect((await store.forCase(caseId)).map(withoutId)).toEqual((await files.forCase(caseId)).map(withoutId));
    // Oldest first, as the file store sorts it.
    expect((await store.forCase(caseId)).map((d) => d.filename)).toEqual(["first.pdf", "second.pdf"]);
    expect(await store.forCase("case-nobody-uploaded-to")).toEqual([]);
  });

  it("returns the original rather than making a second record of identical bytes", async () => {
    const caseId = "case-dedup";
    const bytes = readablePdfBytes("dedup");
    const first = accepted(await store.upload({
      caseId, filename: "review.pdf", bytes, uploadedBy: "ann", at: "2026-08-16T10:00:00.000Z",
    }));

    const again = await store.upload({
      caseId, filename: "renamed-copy.pdf", bytes, uploadedBy: "bea", at: "2026-08-17T09:00:00.000Z",
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.duplicateOf).toBe(first.id);
    // The FIRST upload's document, not the second's metadata: the same bytes are one
    // document, so the filename and uploader stay whoever sent it first.
    expect(again.document).toEqual(first);
    expect(await rowCount(caseId)).toBe(1);

    // Same bytes, different case, is a different document - the dedup key is
    // (caseId, sha256), and the wider global version was the bug documents.ts describes.
    const elsewhere = accepted(await store.upload({
      caseId: "case-dedup-other", filename: "review.pdf", bytes, uploadedBy: "cal", at: "2026-08-17T10:00:00.000Z",
    }));
    expect(elsewhere.id).not.toBe(first.id);
    expect(elsewhere.sha256).toBe(first.sha256);
  });

  it("makes one document out of two simultaneous uploads of the same bytes", async () => {
    // THE CHECK-THEN-INSERT RACE, RUN FOR REAL. Both calls read `byHash` before either
    // inserts, so this is the path where the table's `unique (case_id, sha256)` is what
    // says no rather than the lookup. The loser must answer as a duplicate and must not
    // leave its already-uploaded object behind, which is what the bucket count asserts.
    const caseId = "case-race";
    const bytes = readablePdfBytes("race");
    const input = { caseId, filename: "review.pdf", bytes, uploadedBy: "ann", at: "2026-08-16T12:00:00.000Z" };

    const before = (await bucketKeys()).length;
    const [a, b] = await Promise.all([store.upload(input), store.upload(input)]);

    expect(accepted(a).id).toBe(accepted(b).id);
    expect(await rowCount(caseId)).toBe(1);
    expect((await bucketKeys()).length).toBe(before + 1);
  });

  it("refuses a file over the size limit without writing anything", async () => {
    const before = await bucketKeys();
    const tempBefore = await strays();

    // A valid PDF header, so size is the only thing that can refuse it.
    const huge = Buffer.alloc(MAX_BYTES + 1);
    huge.write("%PDF-1.4\n", "latin1");

    const r = await store.upload({
      caseId: "case-too-large", filename: "enormous.pdf", bytes: huge, uploadedBy: "ann", at: "2026-08-16T10:00:00.000Z",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rejection.kind).toBe("too_large");
    // The same refusal the file store gives, word for word. The wording is what the
    // uploader reads, and two stores that disagree about it means the message changes
    // when the backing does - for the same file, on the same limit.
    expect(r).toEqual(await files.upload({
      caseId: "case-too-large", filename: "enormous.pdf", bytes: huge, uploadedBy: "ann", at: "2026-08-16T10:00:00.000Z",
    }));

    expect(await rowCount("case-too-large")).toBe(0);
    expect(await bucketKeys()).toEqual(before);
    expect(await strays()).toEqual(tempBefore);
  });

  it("refuses a scanned document and leaves neither a row, an object, nor a temp file", async () => {
    const before = await bucketKeys();
    const tempBefore = await strays();

    const input = {
      caseId: "case-unreadable", filename: "scan.pdf", bytes: scannedPdfBytes(),
      uploadedBy: "ann", at: "2026-08-16T10:00:00.000Z",
    };
    const r = await store.upload(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rejection.kind).toBe("unreadable");
    expect(r.rejection.kind === "unreadable" && r.rejection.measurement.verdict).toBe("scanned");
    // Measurement and all: the refusal the uploader sees is the file store's refusal,
    // which is the whole point of running the same measurer over a temp file. This is the
    // gate documents.ts was written for - two of the first five real documents were
    // unusable, and one of them was 48 pages of scan carrying no characters.
    expect(r).toEqual(await files.upload(input));

    expect(await rowCount("case-unreadable")).toBe(0);
    // The divergence from the file store, asserted rather than assumed: a refused
    // document's bytes are not uploaded, because an object with no row pointing at it is
    // unreachable and permanent.
    expect(await bucketKeys()).toEqual(before);
    // The measurement still ran, so a temp file existed during the call and must be gone.
    expect(await strays()).toEqual(tempBefore);
  });

  it("extracts real text through the temp file, and caches it", async () => {
    const doc = accepted(await store.upload({
      caseId: "case-text", filename: "review.pdf", bytes: readablePdfBytes("text"),
      uploadedBy: "ann", at: "2026-08-16T10:00:00.000Z",
    }));

    const tempBefore = await strays();
    const pages = await store.textFor(doc.id);
    expect(pages).toHaveLength(4);
    expect(pages[0]!.page).toBe(1);
    expect(pages[0]!.text.toLowerCase()).toContain("toxicology");
    expect(pages[3]!.text).toContain("Page 4");
    expect(await strays()).toEqual(tempBefore);

    // CACHED, PROVED WITHOUT A STOPWATCH: a Python that does not exist cannot extract
    // anything, so identical pages coming back from it are pages that were never
    // re-extracted. Timing this instead would be a flaky assertion about a loaded machine.
    expect(await store.textFor(doc.id, "definitely-not-a-python-interpreter")).toEqual(pages);

    expect(await store.textFor("doc_does_not_exist")).toEqual([]);
  });

  it("deletes the temp file when the work against it throws", async () => {
    const doc = accepted(await store.upload({
      caseId: "case-throwing", filename: "review.pdf", bytes: readablePdfBytes("throwing"),
      uploadedBy: "ann", at: "2026-08-16T10:00:00.000Z",
    }));

    const tempBefore = await strays();
    let seen = "";
    await expect(store.withLocalFile(doc.id, (path) => {
      seen = path;
      // The file is real while the callback holds it - otherwise this test would pass
      // for a store that never downloaded anything.
      expect(existsSync(path)).toBe(true);
      throw new Error("the work blew up");
    })).rejects.toThrow("the work blew up");

    expect(seen).not.toBe("");
    expect(existsSync(seen)).toBe(false);
    expect(await strays()).toEqual(tempBefore);
  });

  it("deletes the temp file when extraction itself fails", async () => {
    // A cold document, so the cache cannot answer and the extractor really runs.
    const doc = accepted(await store.upload({
      caseId: "case-broken-python", filename: "review.pdf", bytes: readablePdfBytes("broken-python"),
      uploadedBy: "ann", at: "2026-08-16T10:00:00.000Z",
    }));

    const tempBefore = await strays();
    const bucketBefore = await bucketKeys();

    // Extraction returns [] rather than throwing - documents.ts's contract, so that an
    // unreadable document becomes "nothing matched" instead of a 500.
    expect(await store.textFor(doc.id, "definitely-not-a-python-interpreter")).toEqual([]);
    expect(await strays()).toEqual(tempBefore);
    // And the empty result is NOT cached: a broken interpreter is transient, and a
    // cached [] would outlive the fix and leave the document permanently unsearchable.
    expect(await bucketKeys()).toEqual(bucketBefore);
  });

  it("refuses to invent a filesystem path", async () => {
    // The one method that deliberately does not imitate DocumentStore. A temp path
    // returned here would satisfy `existsSync` and `createReadStream` in server.ts and
    // leak up to 80 MB per document view. The message has to name the replacements,
    // because it is the only thing the caller who hit this will read.
    await expect(store.pathFor("doc_whatever")).rejects.toThrow(/streamFor/);
    await expect(store.pathFor("doc_whatever")).rejects.toThrow(/withLocalFile/);
  });

  it("streams the stored bytes back exactly as they were uploaded", async () => {
    const bytes = readablePdfBytes("stream-for");
    const doc = accepted(await store.upload({
      caseId: "case-stream", filename: "review.pdf", bytes, uploadedBy: "ann", at: "2026-08-16T10:00:00.000Z",
    }));

    const stream = await store.streamFor(doc.id);
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk as Uint8Array));
    // Compared by digest rather than by length: a stream reassembled in the wrong order,
    // or one chunk short, has the right length far more often than the right hash. This is
    // the same value `server.ts` sends as the etag, so a mismatch here is a reader whose
    // cache never revalidates.
    expect(sha(Buffer.concat(chunks))).toBe(sha(bytes));

    // NULL WHILE THE STATUS LINE IS STILL UNWRITTEN. `server.ts` resolves the document
    // before `writeHead`, because a 200 already sent cannot become a clean 500 - the
    // reader would get a truncated PDF instead of "document_missing".
    expect(await store.streamFor("doc_does_not_exist")).toBeNull();
  });
});

/**
 * COPIED FROM server.test.ts, where the same builder and the same reasoning already live,
 * because it is a local helper there rather than an export. Kept identical on purpose: it
 * is tuned to the real gate in measure_pdf.py, and a version that drifts would start
 * being refused with a 422 that looks like a bug in this store.
 *
 *   MIN_CHARS_PER_PAGE  40    a page under it counts as sparse
 *   REVIEW_TERMS        toxicolog >= 10, OR nonclinical + non-clinical >= 5
 *   MIN_TOX_DENSITY     0.25  toxicolog hits per page
 *   liver terms         at least one
 *
 * `variant` changes the embedded text and therefore the content hash, which is what lets
 * one test upload a document the dedup key has never seen. The builder is split in two
 * here because these tests also need the opposite document - four pages with no text on
 * them - to exercise the refusal.
 */
const PAGE_LINES = [
  "Nonclinical toxicology review: toxicology summary of hepatic findings.",
  "Toxicology assessment, toxicology endpoints, and nonclinical toxicology data.",
  "Liver: ALT and AST elevations, transaminase changes, hepatic necrosis noted.",
  "Non-clinical toxicology NOAEL derivation; toxicology margins are stated.",
];
const PAGES = 4;

const readablePdfBytes = (variant = ""): Buffer =>
  pdfBytes((p) => [...PAGE_LINES, `Page ${p} of the nonclinical toxicology review. ${variant}`.trim()]);

/**
 * Four real pages carrying no text at all - the shape of the 48-page scan that opens
 * documents.ts, and the refusal that store exists to make.
 *
 * CHOSEN OVER A CORRUPT `%PDF-1.4\n%%EOF` for the refusal-parity test, because
 * measure_pdf.py's "could not open" reason embeds the FILE PATH it was handed, and the
 * two stores necessarily hand it different paths. This document opens cleanly and is
 * refused on its content, so both stores produce the identical refusal - and it exercises
 * the gate that matters rather than a malformed header.
 */
const scannedPdfBytes = (): Buffer => pdfBytes(() => []);

function pdfBytes(linesFor: (page: number) => string[]): Buffer {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "", // Pages, filled once the kid ids are known
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  const kids: string[] = [];
  for (let p = 0; p < PAGES; p++) {
    const lines = linesFor(p + 1);
    const content = lines.length === 0
      ? ""
      : `BT /F1 11 Tf 50 720 Td 14 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${PAGES} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
