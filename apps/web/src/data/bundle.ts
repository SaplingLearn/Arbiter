/**
 * Every data import in the application, in one place.
 *
 * Imported as ES modules at BUILD TIME, never fetched. Over file:// a fetch of a
 * sibling JSON file is blocked as a cross-origin request in Chrome and Edge, so a
 * served build could fetch and the submitted static build could not - two code
 * paths, one of them untested. Importing gives one path that works in both.
 *
 * results.json is deliberately absent: 676KB of almost entirely recomputable
 * data. verdict-manifest.json carries the cross-check instead.
 */
import evidence from "../../../../data/out/evidence.json";
import compounds from "../../../../data/out/compounds.json";
import splits from "../../../../data/out/splits.json";
import fixture from "../../../../data/out/tak994.json";
import assays from "../../../../data/assays.json";
import ruleset from "../../../../rules/ruleset-v1.0.json";
import metrics from "../../../../results/metrics.json";
import manifest from "../../../../results/verdict-manifest.json";

export const RAW = { evidence, compounds, splits, fixture, assays, ruleset, metrics, manifest };
