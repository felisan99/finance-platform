import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Reglas que hacen cumplir "lib/engine es PURO" (CLAUDE.md): sin red, sin
// base de datos, sin reloj implícito, sin azar. La fecha "hoy" entra como parámetro.
const pureGlobals = [
  "fetch",
  "process",
  "window",
  "document",
  "localStorage",
  "sessionStorage",
];

const pureProperties = [
  {
    object: "Date",
    property: "now",
    message: "Función pura: recibí la fecha 'hoy' como parámetro.",
  },
  {
    object: "Math",
    property: "random",
    message:
      "Función pura: no uses azar; los tests deterministas lo necesitan.",
  },
  {
    object: "performance",
    property: "now",
    message: "Función pura: no leas el reloj.",
  },
  {
    object: "crypto",
    property: "randomUUID",
    message: "Función pura: los ids los asigna quien llama.",
  },
];

const pureSyntax = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      "new Date() sin argumentos lee el reloj: recibí la fecha como parámetro.",
  },
];

const ioImports = [
  {
    group: ["@supabase/*"],
    message: "Sin acceso a la base de datos desde código puro.",
  },
  {
    group: ["next", "next/*", "react", "react/*", "react-dom", "react-dom/*"],
    message: "Sin framework en código puro.",
  },
  {
    group: [
      "node:*",
      "fs",
      "fs/*",
      "path",
      "crypto",
      "http",
      "https",
      "child_process",
    ],
    message: "Sin I/O ni APIs de Node en código puro.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Motor de cálculo: además, no puede depender de capas superiores.
    files: ["lib/engine/**/*.ts"],
    ignores: ["lib/engine/**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...ioImports,
            {
              group: [
                "@/lib/db/*",
                "@/lib/market-data/*",
                "@/lib/importers/*",
                "**/db/*",
                "**/market-data/*",
                "**/importers/*",
              ],
              message: "lib/engine no depende de db, market-data ni importers.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", ...pureGlobals],
      "no-restricted-properties": ["error", ...pureProperties],
      "no-restricted-syntax": ["error", ...pureSyntax],
    },
  },
  {
    // Importadores: parseo puro de texto; el I/O (leer el archivo, insertar) vive afuera.
    files: ["lib/importers/**/*.ts"],
    ignores: ["lib/importers/**/__tests__/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ioImports }],
      "no-restricted-globals": ["error", ...pureGlobals],
      "no-restricted-properties": ["error", ...pureProperties],
      "no-restricted-syntax": ["error", ...pureSyntax],
    },
  },
  // Desactiva reglas de estilo que chocan con Prettier (debe ir al final de las reglas).
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generado
    "coverage/**",
    "lib/db/database.types.ts",
  ]),
]);

export default eslintConfig;
