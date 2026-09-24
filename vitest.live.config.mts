import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

const root = resolve(dirname(fileURLToPath(import.meta.url)));

function loadDotEnvLocal(): Record<string, string> {
  try {
    return parseEnv(
      readFileSync(resolve(root, ".env.local"), "utf8"),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

// Pruebas "en vivo": pegan contra Yahoo Finance REAL y contra finance-dev. Dependen de la red y
// de un servicio no oficial, así que no corren en `pnpm test`, ni en `pnpm test:integration`,
// ni en el CI: se lanzan a mano con `pnpm test:live`.
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": resolve(root, "lib/db/__tests__/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.live.test.ts"],
    env: loadDotEnvLocal(),
    fileParallelism: false,
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
