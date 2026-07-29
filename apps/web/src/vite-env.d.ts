/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * "1" turns the live rung on. Anything else, including unset, leaves it off.
   *
   * The submitted ZIP is built without it, which is one of the two gates in
   * src/ai/client.ts (spec section 2). Declared here so that the flag's contract
   * is written down somewhere rather than living only in a string comparison.
   */
  readonly VITE_ARBITER_LIVE?: string;
}
