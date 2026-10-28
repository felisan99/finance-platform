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

// Evals del asistente (`pnpm eval`): llaman a modelos reales por OpenRouter y gastan requests del
// límite diario (y créditos con los modelos pagos). Manual: no corren en `pnpm test` ni en el CI.
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": resolve(root, "lib/db/__tests__/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    env: loadDotEnvLocal(),
    fileParallelism: false,
    testTimeout: 3 * 60 * 60 * 1000,
  },
});
