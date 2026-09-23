import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

const root = resolve(dirname(fileURLToPath(import.meta.url)));

// Las variables de .env.local (URL, claves) llegan a los tests. Si el archivo no existe, los
// tests se niegan a correr con un mensaje claro (ver assertDevProject).
function loadDotEnvLocal(): Record<string, string> {
  try {
    return parseEnv(
      readFileSync(resolve(root, ".env.local"), "utf8"),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

// Tests de integración: pegan contra el proyecto Supabase de DESARROLLO. No corren en `pnpm test`
// ni en el CI. Se ejecutan de a uno porque comparten el proyecto en la nube.
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": resolve(root, "lib/db/__tests__/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/__tests__/**/*.integration.test.ts"],
    env: loadDotEnvLocal(),
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
