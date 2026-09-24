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
- Crons (`/api/cron/*`): públicos para el proxy, protegidos solo por `Authorization: Bearer ${CRON_SECRET}` con comparación en tiempo constante; fallan cerrado si el secreto falta o es corto (`lib/cron/`). Usan `lib/db/admin.ts` (es un cron, no un usuario). Los jobs reciben "hoy" por parámetro.
- Todo lo que devuelve un proveedor de datos es entrada no confiable: se valida con Zod y se sanea (`lib/market-data/`). Los montos del proveedor son strings decimales, nunca floats.
- PostgREST corta las respuestas en 1000 filas: las lecturas que puedan pasar de eso (series de `prices_daily`, historial de transacciones) se paginan con `.range()`.
- Los `numeric` se leen como texto (`columna::text`) y entran al motor con `d()`; cada fila se valida con Zod en el borde (`lib/portfolio/rows.ts`). Al escribir, el número se arma en `lib/portfolio/mappers.ts` (los límites de dígitos del formulario lo hacen exacto).
- Todo dinero que ve la persona se formatea con `lib/portfolio/format.ts` (es-UY, hora de Montevideo); nunca `toFixed`/`toLocaleString` sueltos en los componentes. Ganancia y pérdida: `<Pnl>` (color + signo + flecha).
- Toda Server Action y Route Handler: `getSessionUser()` (usa `getClaims()`), Zod sobre lo recibido, errores genéricos hacia afuera (el detalle a `console.error`), y límite de uso en la base (`takeRateLimit`) si llama a un servicio externo. La clave secreta solo para dar de alta instrumentos y escribir cotizaciones.
- Alta, edición y baja de transacciones pasan por `validateLedgerChange` antes de guardar.
- Serie histórica, TWR, XIRR y benchmark son del motor puro (`lib/engine/{dates,series,returns,performance}.ts`); la lectura de cierres y el formato están en `lib/portfolio/`. Los cierres guardados están ajustados por splits: se des-ajustan con los `SPLIT` del libro, no con `corporate_actions`. El XIRR usa `number` (es una tasa para mostrar, no un monto). El benchmark (`SPY`) es un instrumento más que mantienen los jobs (`active_instruments()` lo incluye).
- Los componentes de cliente no importan `lib/engine` ni `lib/portfolio/format.ts` (arrastrarían decimal.js al navegador): reciben textos y `number` ya preparados en el servidor (`performance-view.ts`, `allocation-view.ts`) y usan `chart-format.ts`, `pnl-text.tsx`.
- Toda acción que pueda dejar un instrumento nuevo sin precios (importar, guardar una operación con símbolo, "Actualizar precios") llama a `backfillPendingInBackground` (`lib/portfolio/background.ts`): descarga el historial sin bloquear la respuesta.

# Convenciones

- Identificadores en inglés; comentarios de código en español, solo donde el porqué no es obvio; docs y textos de UI en español.
- Nunca commitear historial real de inversiones, capturas de un portafolio real ni datos de `finance-dev`.
- Habilitar a una persona: `insert into public.allowed_emails (email) values ('...')` (ver docs/supabase-setup.md).

# Comandos

```
pnpm dev | pnpm test | pnpm lint | pnpm typecheck | pnpm build
pnpm test:integration   # RLS y registro contra finance-dev (necesita .env.local)
pnpm test:live          # cron real contra Yahoo real + la app por HTTP con sesión real (a mano; no va al CI; la de HTTP necesita `pnpm build` antes)
pnpm db:push            # migraciones a finance-dev
pnpm db:types           # regenera lib/db/database.types.ts
pnpm db:config-diff     # revisar antes de `pnpm supabase config push`
```
