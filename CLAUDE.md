@AGENTS.md

# Contexto

Portfolio tracker personal. La especificación completa está en PROJECT_SPEC.md: leerla antes de cualquier tarea grande. Desvíos respecto del spec y observaciones pendientes: docs/decisions.md. Operación de Supabase (entornos, claves, invitar gente): docs/supabase-setup.md.

# Reglas

- TypeScript strict. Nada de `any` sin justificar.
- lib/engine es PURO: sin imports de Supabase, fetch ni Date.now() implícito (recibir la fecha "hoy" como parámetro). ESLint lo hace cumplir (eslint.config.mjs).
- Dinero con decimal.js (constructor aislado `D` de lib/engine/decimal.ts); nunca aritmética de floats para montos persistidos.
- Todo cambio de esquema = nueva migración en supabase/migrations. **Toda migración que crea una tabla incluye sus GRANT y su RLS**: los privilegios por defecto de `public` están revocados para `anon` y `authenticated`.
- Todo cálculo nuevo del motor lleva tests en Vitest, incluidos casos borde.
- Validar inputs con Zod en el servidor.
- No exponer SUPABASE_SECRET_KEY al cliente. Salta RLS: `lib/db/admin.ts` es `server-only` y se usa solo para tareas que no pertenecen a un usuario (crons, alta de instrumentos), nunca para atender lecturas o escrituras de un usuario.
- En el servidor la sesión se verifica con `getClaims()`, nunca con `getSession()`. El proxy no es una barrera de autorización: cada página o acción vuelve a verificar y RLS protege los datos.
- Supabase solo en la nube (sin Docker ni stack local): `finance-dev` para desarrollo y `finance` para producción (Fase 7). No hacer `supabase link` ni `db push` a `finance` sin pedido explícito; los scripts `pnpm db:*` se niegan a operar si el proyecto vinculado no es el de desarrollo.
- Nunca `supabase config push` sin correr antes `pnpm db:config-diff` y revisar el diff: sin TTY la CLI aplica los cambios sin preguntar. `supabase/config.toml` declara solo lo que gestionamos (no es la plantilla de `init`).
- Los tests de integración (`pnpm test:integration`) corren solo contra `finance-dev` (se niegan a correr contra otro proyecto) y no van al CI.

# Convenciones

- Identificadores en inglés; comentarios de código en español, solo donde el porqué no es obvio; docs y textos de UI en español.
- Nunca commitear historial real de inversiones, capturas de un portafolio real ni datos de `finance-dev`.
- Habilitar a una persona: `insert into public.allowed_emails (email) values ('...')` (ver docs/supabase-setup.md).

# Comandos

```
pnpm dev | pnpm test | pnpm lint | pnpm typecheck | pnpm build
pnpm test:integration   # RLS y registro contra finance-dev (necesita .env.local)
pnpm db:push            # migraciones a finance-dev
pnpm db:types           # regenera lib/db/database.types.ts
pnpm db:config-diff     # revisar antes de `pnpm supabase config push`
```
