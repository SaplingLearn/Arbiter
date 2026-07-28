import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extractGolden } from "./golden.js";

/**
 * Deliberately re-baseline the golden numbers.
 *
 * Only run this when a number moved ON PURPOSE. The resulting diff is the record
 * of what changed and belongs in its own commit with a reason.
 */
const golden = extractGolden(JSON.parse(readFileSync("results/metrics.json", "utf8")));
mkdirSync("results/golden", { recursive: true });
writeFileSync("results/golden/metrics.golden.json", JSON.stringify(golden, null, 2));
console.log("Updated results/golden/metrics.golden.json - commit the diff with a reason.");
