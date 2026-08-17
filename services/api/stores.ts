import { AuthStore } from "./auth.js";
import { databaseUrl, pool } from "./db.js";
import { DocumentStore, type DocumentStoreApi } from "./documents.js";
import { InviteStore } from "./invites.js";
import { PostgresAuthStore, type AuthStoreApi } from "./postgres-auth.js";
import { PostgresInviteStore, type InviteStoreApi } from "./postgres-invites.js";
import { PostgresStore } from "./postgres-store.js";
import { FileStore, type DeliberationStore } from "./store.js";
import { SupabaseDocumentStore, bucketFrom, storageClientFrom } from "./supabase-documents.js";

/**
 * Which stores this process runs on, decided ONCE.
 *
 * THE WHOLE POINT IS THAT THIS IS THE ONLY PLACE THAT ASKS. Scattered
 * `if (process.env["DATABASE_URL"])` checks are how a process ends up half-migrated -
 * the log in Postgres and the accounts still on disk, or the reverse - and that state is
 * not a degraded mode, it is a deployment whose record and whose identities disagree
 * about which machine they live on. One decision, taken here, applied to all four.
 *
 * FILES ARE THE DEFAULT, and that is not a hedge. `npm test` and `npm run e2e` run with
 * no database, and the product they exercise has to be the product. A default that
 * required Postgres would mean the suite either stopped running or started testing
 * something nobody deploys. CI sets `DATABASE_URL` on its `npm test` step only, so the
 * Postgres stores are exercised there without moving what anything else measures.
 */

export interface Stores {
  deliberation: DeliberationStore;
  auth: AuthStoreApi;
  invites: InviteStoreApi;
  documents: DocumentStoreApi;
  /** One line for the startup banner. Which backing is live is the single fact most
   *  worth printing: "the data is gone" and "the data is in the other store" look
   *  identical from a screen showing an empty case list. */
  describe: string;
}

/**
 * Postgres without Storage is a REFUSAL, not a fallback, and this is the one
 * configuration error worth failing the boot over.
 *
 * The tempting behaviour - Postgres for the log, the local disk for documents - produces
 * a container that looks entirely healthy and loses every uploaded PDF on redeploy while
 * faithfully keeping the log entries that cite them. The result is a deliberation record
 * that survives, pointing at evidence that does not: findings whose `sourceDocumentId`
 * resolves to nothing, and a reader that cannot open the page a position was argued from.
 * That is worse than not starting, because nobody discovers it until they go looking for
 * a document, by which time the uploads are already gone.
 *
 * Checked here rather than at first upload so it fails at deploy time, in front of the
 * person who set the variables.
 */
function requireStorageConfig(env: NodeJS.ProcessEnv): void {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter(
    (k) => (env[k] ?? "").trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `DATABASE_URL is set, so this process stores the deliberation record in Postgres - but ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set, so uploaded documents would have nowhere to go.\n` +
        "Set them, or unset DATABASE_URL to run entirely on local files. A half-and-half process keeps the log and loses the evidence it cites.",
    );
  }
}

export async function buildStores(
  logPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Stores> {
  const url = databaseUrl(env);

  if (url === null) {
    return {
      deliberation: await FileStore.open(logPath),
      auth: await AuthStore.open(`${logPath}.users.json`),
      invites: await InviteStore.open(`${logPath}.invites.json`),
      documents: await DocumentStore.open("results/documents"),
      describe: `local files (${logPath}; set DATABASE_URL for Postgres)`,
    };
  }

  requireStorageConfig(env);

  /* THE POOL IS BUILT FROM THE `env` THIS FUNCTION WAS GIVEN, and then handed to all
     four stores. Each of them defaults to `pool()`, which reads `process.env` - so a
     caller passing an `env` whose `DATABASE_URL` differs from the ambient one would
     have selected the Postgres branch from one database and then connected to another,
     or thrown "DATABASE_URL is not set" from inside a branch that only exists because
     it was. Latent while every caller passes the real environment; the parameter is
     what makes it reachable, so the parameter is what has to be honoured. */
  const p = pool(url);

  return {
    deliberation: new PostgresStore(p),
    auth: await PostgresAuthStore.open(p),
    invites: await PostgresInviteStore.open(p),
    documents: await SupabaseDocumentStore.open({ env, pool: p }),
    // The host, never the connection string: it carries the password, and this line goes
    // to stdout, which on every host this runs on means the log aggregator.
    describe: `Postgres (${safeHost(url)}), documents in Supabase Storage bucket "${bucketFrom(env)}"`,
  };
}

/**
 * Reachability, reported rather than enforced.
 *
 * NOT a boot-time hard failure, unlike the missing-variable check above, and the
 * difference is whether the fault is in the configuration or in the network. A typo'd
 * bucket name is permanent and worth refusing to start over; a Storage endpoint that is
 * briefly unreachable is not, and a container that refuses to boot on a transient blip
 * turns a thirty-second outage into an outage that lasts until someone notices.
 *
 * So this only decides what the banner says. `SupabaseDocumentStore.open` deliberately
 * does not create the bucket - creating infrastructure as a side effect of opening a
 * store means a typo silently provisions a second empty one - and the cost of that
 * choice is that a wrong name is otherwise not visible until somebody's first upload.
 * This pays that cost down to "it is in the startup output".
 */
export async function describeStorage(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (databaseUrl(env) === null) return "results/documents (local files)";
  const bucket = bucketFrom(env);
  try {
    const { error } = await storageClientFrom(env).storage.from(bucket).list("", { limit: 1 });
    if (error !== null) {
      return `WARNING - bucket "${bucket}" did not answer: ${error.message}. Uploads will fail until it exists.`;
    }
    return `Supabase Storage, bucket "${bucket}"`;
  } catch (e) {
    return `WARNING - could not reach Supabase Storage: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Host and database only. A connection string in a log line is a leaked password. */
function safeHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return "configured";
  }
}
