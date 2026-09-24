import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const root = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  resolve: {
    alias: {
      // Mismo alias que tsconfig.json ("@/*" -> raíz del repo).
      "@": root,
      // `server-only` lanza fuera del servidor de Next; en los tests se reemplaza por un módulo vacío.
      "server-only": resolve(root, "lib/db/__tests__/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.test.ts"],
    // Los de integración pegan contra Supabase (finance-dev): van por `pnpm test:integration`;
    // los "en vivo" también contra Yahoo real: `pnpm test:live`.
    exclude: [
      ...configDefaults.exclude,
      "**/*.integration.test.ts",
      "**/*.live.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "lib/engine/**/*.ts",
        "lib/importers/**/*.ts",
        "lib/validation/**/*.ts",
        "lib/db/auth-routes.ts",
        "lib/db/env.ts",
      ],
      exclude: ["**/__tests__/**", "**/__fixtures__/**"],
    },
  },
});
