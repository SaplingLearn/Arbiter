import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Folds the JS chunk and the stylesheet into index.html so the built app makes
 * ZERO subresource requests.
 *
 * This is not an optimisation, it is the only way the submitted artifact works.
 * Vite tags its emitted <script> and <link> with `crossorigin`, which makes
 * Chrome treat them as CORS requests. A page opened from the filesystem has
 * origin `null`, and file:// is not a scheme CORS can satisfy, so both the
 * script and the stylesheet fail with ERR_FAILED and the page renders
 * completely blank - measured, not assumed. Serving over http:// hides this
 * entirely, so a dev server is exactly the wrong place to look for it.
 *
 * The guard against regression is apps/web/e2e/static-file.spec.ts, which opens
 * dist/index.html over file:// and asserts the verdict actually renders.
 */
function inlineEverything(): Plugin {
  return {
    name: "arbiter-inline-everything",
    enforce: "post",
    apply: "build",
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (!html || html.type !== "asset") {
        throw new Error("inlineEverything: no index.html in the bundle");
      }
      let source = String(html.source);

      // Deleting a bundle entry whose tag was never found would satisfy the
      // survivors check below while leaving a dead reference in the HTML, so
      // every substitution has to be observed to change the source.
      const substitute = (pattern: RegExp, replacement: () => string, what: string): void => {
        const next = source.replace(pattern, replacement);
        if (next === source) throw new Error(`inlineEverything: no tag found for ${what}`);
        source = next;
      };

      for (const [fileName, output] of Object.entries(bundle)) {
        if (fileName === "index.html") continue;

        if (output.type === "chunk") {
          // A closing script tag inside the JS would end the element early. The
          // escaped form is inert to the HTML parser and identical to JS.
          const code = output.code.replace(/<\/script/gi, "<\\/script");
          // A replacer FUNCTION, not a replacement string: minified JS is full of
          // `$`, and in a replacement string `$&`, `$'` and `` $` `` are
          // substitution patterns. They silently spliced the original tag back
          // into the middle of the code and produced a SyntaxError.
          substitute(
            new RegExp(`<script[^>]*src="\\.?/?${fileName}"[^>]*></script>`),
            // type="module" is kept, and it matters twice over. It preserves the
            // deferred execution the original tag had - an inline classic script
            // in <head> runs before <body> exists, so createRoot got a null
            // container and React threw #299. And an INLINE module script issues
            // no request, so there is nothing for CORS to block; it was the
            // crossorigin attribute on the external src that broke file://, not
            // module semantics.
            () => `<script type="module">${code}</script>`,
            fileName,
          );
          delete bundle[fileName];
        } else if (fileName.endsWith(".css")) {
          const css = String(output.source).replace(/<\/style/gi, "<\\/style");
          substitute(
            new RegExp(`<link[^>]*href="\\.?/?${fileName}"[^>]*>`),
            () => `<style>${css}</style>`,
            fileName,
          );
          delete bundle[fileName];
        }
      }

      html.source = source;

      // The invariant, checked on the bundle rather than on the HTML text: if
      // anything besides index.html survives, the artifact has a subresource,
      // and a subresource is a blank page over file://. Scanning the HTML for
      // leftover src=/href= would instead scan the 1MB of inlined JS and trip
      // over string literals inside it.
      const survivors = Object.keys(bundle).filter((k) => k !== "index.html");
      if (survivors.length > 0) {
        throw new Error(
          `inlineEverything: ${survivors.length} asset(s) not inlined: ${survivors.join(", ")}`,
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineEverything()],
  // Relative base so the built index.html opens directly from the filesystem.
  // The static ZIP submission depends on this.
  base: "./",
  build: {
    outDir: "dist",
    // Inline every asset as a data URI. The default 4KB threshold would leave
    // small files as separate fetches, which is the same file:// failure in
    // miniature. Deliberately not 0.
    assetsInlineLimit: 100_000_000,
    // One chunk, so there is one script to inline and no modulepreload links.
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
