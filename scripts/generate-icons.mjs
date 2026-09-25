// Genera los íconos de la app (PWA) una sola vez: `node scripts/generate-icons.mjs`. Los PNG se
// versionan en public/icons/; este script queda para regenerarlos si cambia el diseño.
// Fondo casi negro (el de la app en modo oscuro) y un trazo de gráfico blanco: sobrio, sin adornos.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// `next/og` es CommonJS sin extensión: en ESM se pide con `require`.
const { ImageResponse } = createRequire(import.meta.url)("next/og");

const OUT = resolve(import.meta.dirname, "../public/icons");
const BACKGROUND = "#0a0a0a";
const STROKE = "#fafafa";

// Trazo del gráfico en una grilla de 100 × 100 (sube con una muesca a mitad de camino; queda centrado en vertical).
const LINE = "M16 71 L36 51 L50 63 L84 29";
const END = { x: 84, y: 29 };

/**
 * `scale` achica el dibujo alrededor del centro: los íconos "maskable" pueden recortarse en círculo
 * u otras formas y solo se garantiza el 80 % central (zona segura).
 */
function icon(size, scale) {
  const glyph = size * scale;
  return {
    type: "div",
    props: {
      style: {
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BACKGROUND,
      },
      children: {
        type: "svg",
        props: {
          width: glyph,
          height: glyph,
          viewBox: "0 0 100 100",
          children: [
            {
              type: "path",
              props: {
                d: LINE,
                fill: "none",
                stroke: STROKE,
                strokeWidth: 8,
                strokeLinecap: "round",
                strokeLinejoin: "round",
              },
            },
            {
              type: "circle",
              props: { cx: END.x, cy: END.y, r: 6.5, fill: STROKE },
            },
          ],
        },
      },
    },
  };
}

const TARGETS = [
  // [archivo, tamaño, escala del dibujo]
  ["icon-192.png", 192, 0.62],
  ["icon-512.png", 512, 0.62],
  ["icon-maskable-512.png", 512, 0.5],
  // iOS usa este para "Agregar a pantalla de inicio" y le pone sus propias esquinas.
  ["apple-touch-icon.png", 180, 0.62],
];

mkdirSync(OUT, { recursive: true });
for (const [file, size, scale] of TARGETS) {
  const response = new ImageResponse(icon(size, scale), {
    width: size,
    height: size,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(resolve(OUT, file), bytes);
  console.log(`${file}  ${size}×${size}  ${bytes.length} bytes`);
}
