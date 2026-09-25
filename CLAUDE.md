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
- No exponer SUPABASE_SECRET_KEY al cliente. Salta RLS: `lib/db/admin.ts` es `server-only` y se usa solo para tareas que no pertenecen a un usuario (crons, alta de instrumentos, el límite de intentos del código de ingreso —`lib/db/login-attempts.ts`— que corre antes de que haya sesión), nunca para atender lecturas o escrituras de un usuario.
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
- Serie histórica, TWR, XIRR y benchmark son del motor puro (`lib/engine/{dates,series,returns,performance}.ts`); la lectura de cierres y el formato están en `lib/portfolio/`. Los cierres guardados están ajustados por splits: se des-ajustan con los `SPLIT` del libro, no con `corporate_actions`. El XIRR usa `number` (es una tasa para mostrar, no un monto). El benchmark (`SPY`) es un instrumento más que mantienen los jobs (`active_instruments()` lo incluye). Con «Actualizar precios», la cotización de hoy es el último punto de cada serie cuando es de un día posterior al último cierre (`lib/portfolio/live-series.ts`, sin tocar el motor): todo o nada con el benchmark, y el botón también actualiza el benchmark (`refresh-targets.ts`). El valor de la última fila de la serie tiene que ser el valor total de Inicio (`performance-live.test.ts`).
- Los componentes de cliente no importan `lib/engine` ni `lib/portfolio/format.ts` (arrastrarían decimal.js al navegador): reciben textos y `number` ya preparados en el servidor (`performance-view.ts`, `allocation-view.ts`) y usan `chart-format.ts`, `pnl-text.tsx`.
- Importar CSV: dos formatos que se reconocen solos por los encabezados (`lib/importers/detect.ts`): el **simple** propio (`simple.ts`, el mismo que escribe «Exportar CSV», con `source = 'csv'`) y el de **Delta** (`delta.ts`, `source = 'delta_csv'`). La plantilla (`template.ts`) y el «Exportar CSV» se prueban contra el parser (ida y vuelta): si se cambia una columna hay que tocar los tres. Los símbolos nuevos del formato simple se verifican con el proveedor antes de crearlos (`import-flow.ts`); lo que parece repetir operaciones ya cargadas se excluye por defecto (`import-similar.ts`). Cada transacción importada lleva su `import_id` y se puede deshacer la importación entera (`undo_import`, validada antes con `LedgerChange` `removeMany`). La vista previa (`import-preview.ts`) manda al cliente textos ya formateados. Guía para las personas: `docs/importar-csv.md`.
- Alta de una compra o venta: al elegir el símbolo, `TransactionForm` pide `getReferencePrice` (`lib/portfolio/reference-price.ts` valida y formatea; reutiliza el límite `search_symbols`) y deja la cotización actual escrita en el precio, sin pisar lo que la persona ya tipeó. `SymbolCombobox` despliega su lista con `position: absolute`: no puede vivir dentro de un contenedor con `overflow` recortado (la tarjeta de la Watchlist lleva `overflow-visible` por eso). En el teléfono los `<input type="date">` van uno por renglón: el del iPhone no baja de ~183 px.
- Toda acción que pueda dejar un instrumento nuevo sin precios (importar, guardar una operación con símbolo, "Actualizar precios") llama a `backfillPendingInBackground` (`lib/portfolio/background.ts`): descarga el historial sin bloquear la respuesta.

- El ingreso es con un código de 6 dígitos del correo (`/login`, Server Actions `requestCode` y `verifyCode`); no hay enlace ni ruta de retorno. `otp_length` de `supabase/config.toml` y `CODE_LENGTH` de `lib/validation/login.ts` tienen que coincidir. Toda verificación pasa antes por `takeLoginAttempt` (5 por 15 minutos por email). El SMTP (contraseña de aplicación) se carga solo en el panel de Supabase: no se declara en `config.toml` ni se pega en el chat.
- Las cookies de sesión son `HttpOnly` y, con HTTPS, `Secure` (`lib/db/cookie-options.ts`, usado por `lib/db/server.ts` y `lib/db/proxy.ts`): no hay cliente de Supabase en el navegador y ningún código lee `document.cookie`. Si algún día se agrega uno, hay que revisarlo.
- Público para el proxy (`lib/db/auth-routes.ts`): `/login`, `/api/cron/*`, `/pwa/*`, `/sw.js` y `/manifest.webmanifest` (los dos últimos, exactos). Nada de eso lleva datos de nadie.
- PWA: el service worker (`public/sw.js`) **no cachea páginas ni datos** financieros, solo la pantalla sin conexión; al cambiar un archivo que precachea hay que subir su `VERSION`. El último estado conocido vive en `localStorage` (textos ya formateados, `lib/portfolio/snapshot-cache.ts`) y se borra al llegar a `/login`. El modo oscuro sigue al sistema con CSS (`prefers-color-scheme`), no con la clase `.dark`.
- Inicio (`app/(app)/page.tsx`): el rendimiento se pide **una sola vez** (`loadPerformanceOutcome`, una promesa que nunca se rechaza) y lo comparten tres secciones con su propio `<Suspense>` (gráfico, por mes, riesgo: `components/app/performance-section.tsx`). Las curvas de ganancia, el riesgo y el rendimiento por mes son del motor puro (`lib/engine/{performance,risk,monthly}.ts`); los textos y tonos, de `performance-view.ts` y `contribution-view.ts`. La ganancia total es `valor total − depósitos + retiros` y se oculta si falta algún precio.
- Cabeceras de seguridad y CSP: `next.config.ts` y `lib/security/csp.ts`. La CSP (solo en producción) deja pasar únicamente el propio origen (`connect-src 'self'`, sin cliente de Supabase en el navegador): si un componente necesita cargar algo de otro dominio (imagen, fuente, script, conexión), hay que agregarlo ahí a propósito y con test. Los scripts y estilos en línea siguen permitidos hasta la CSP estricta con nonces (Fase 7). Riesgos residuales aceptados de la revisión de seguridad: `docs/decisions.md`, "Revisión de seguridad".
- Un botón que pasa de `type="button"` a `type="submit"` en el mismo lugar del árbol de React envía el formulario en medio del mismo clic: cada rama lleva su propia `key` (ver `components/app/watchlist-row-footer.tsx`).
- Vercel: nunca correr `vercel` sin revisar qué sube (no respeta todo el `.gitignore`); `.vercelignore` deja afuera los fixtures, `docs/`, el spec, los tests y `supabase/`. Variables de Production: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` y `CRON_SECRET` (las `NEXT_PUBLIC_*` se incorporan al compilar: cargarlas antes del deploy). Se cargan por stdin desde `.env.local` (`... | vercel env add NOMBRE production --sensitive`), sin imprimirlas. El proyecto de Vercel de la Fase 6 apunta a `finance-dev`; producción es la Fase 7.

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
node scripts/generate-icons.mjs   # regenera los íconos de la PWA en public/icons/
```
