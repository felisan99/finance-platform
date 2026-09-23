// Guarda de seguridad de los scripts `db:*`: solo se opera sobre el proyecto de DESARROLLO.
// El de producción se toca únicamente en la Fase 7 y con pedido explícito (CLAUDE.md).
import { readFileSync } from "node:fs";

const projects = JSON.parse(
  readFileSync(new URL("../supabase/projects.json", import.meta.url), "utf8"),
);

let linked = "";
try {
  linked = readFileSync(
    new URL("../supabase/.temp/project-ref", import.meta.url),
    "utf8",
  ).trim();
} catch {
  // sin vincular: se informa abajo
}

if (linked !== projects.dev.ref) {
  console.error(
    `El proyecto vinculado es "${linked || "(ninguno)"}"; solo se opera sobre ${projects.dev.name} (${projects.dev.ref}).`,
  );
  if (linked === projects.prod.ref) {
    console.error("Ese es PRODUCCIÓN: no se toca sin un pedido explícito.");
  }
  console.error(
    `Para vincular desarrollo: pnpm supabase link --project-ref ${projects.dev.ref}`,
  );
  process.exit(1);
}
