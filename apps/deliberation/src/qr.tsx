import { useMemo, type ReactElement } from "react";
import qrcode from "qrcode-generator";

/**
 * A QR code, as vectors.
 *
 * SVG AND NOT CANVAS, because this is printed. A canvas is a bitmap at one resolution
 * and a printer works at another; a code that scans on screen and blurs on paper is a
 * code that fails in the only place it was added for.
 *
 * ERROR CORRECTION AT "M". The code is printed onto a page that will be folded, copied
 * and marked up, so the lowest level is wrong; "H" would survive more damage and makes
 * the code denser, which costs more than it buys on a URL this long.
 *
 * ONE DEPENDENCY, chosen for having none of its own - `router.ts` objects to transitive
 * trees rather than to libraries, and a QR encoder is Reed-Solomon and mask evaluation
 * rather than the thirty lines that argument permits us to write ourselves. A wrong
 * implementation here also fails loudly: the code simply does not scan.
 */
export function QrCode({ value, size }: { value: string; size: number }): ReactElement {
  const { modules, count } = useMemo(() => {
    // Type 0 lets the library pick the smallest version the data fits in.
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const dark: { x: number; y: number }[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) if (qr.isDark(y, x)) dark.push({ x, y });
    }
    return { modules: dark, count: n };
  }, [value]);

  return (
    <svg
      className="rep-qr"
      role="img"
      width={size}
      height={size}
      /* The viewBox is in MODULES, so the same drawing serves the 120px preview and a
         600dpi print without re-encoding and without rounding modules to whole pixels. */
      viewBox={`0 0 ${String(count)} ${String(count)}`}
      shapeRendering="crispEdges"
    >
      <title>{value}</title>
      {/* The quiet zone is the white background; the spec requires four modules of it,
          which the printed block provides as padding around this element. */}
      <rect width={count} height={count} fill="#fff" />
      {modules.map((m) => (
        <rect key={`${String(m.x)}-${String(m.y)}`} x={m.x} y={m.y} width={1} height={1} fill="#000" />
      ))}
    </svg>
  );
}
