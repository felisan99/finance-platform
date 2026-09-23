# Decisiones y observaciones

Registro de lo que se decidió al implementar y de lo que el spec (`PROJECT_SPEC.md`) deja abierto o contradice. El spec no se modifica por estas notas: lo que requiere un cambio de spec está marcado **[requiere OK]**.

## Tareas pendientes

- **Antes de la Fase 6 (y antes de invitar a cualquier persona): ingreso con código OTP de 6 dígitos + SMTP propio.** Pedido de Felipe (2026-09-24), después de comprobar que el login con enlace funciona en el navegador. El enlace del correo se abre en Safari, no en la PWA instalada, y el correo por defecto de Supabase (2 mensajes por hora, solo a miembros de la organización, sin plantillas propias) no alcanza para nadie más. Alcance:
  1. Configurar SMTP propio en Supabase Auth (Resend u otro con plan gratuito; revisar en su documentación si el plan gratuito exige un dominio propio verificado para enviar a terceros, no está confirmado) y probarlo en `finance-dev`.
  2. Plantilla de correo en español con el código (`{{ .Token }}`); el largo del OTP ya es de 6 dígitos en el proyecto.
  3. `/login` en dos pasos: email → campo de código. Server action con `verifyOtp({ email, token, type: "email" })` y validación Zod; mensajes de código incorrecto/vencido y límite de intentos.
  4. Decidir qué pasa con `/auth/callback` (queda como respaldo o se elimina), actualizar los tests, `docs/supabase-setup.md` y este archivo. Correr `pnpm db:config-diff` antes de cualquier `config push`.

## Ajustes al spec ya aplicados (2026-09-23)

- **Sin Supabase local.** Dos proyectos en la nube: `finance-dev` (desarrollo) y `finance` (producción, Fase 7). `supabase init` sin Docker; en la Fase 2 se vincula `finance-dev` con `supabase link` y las migraciones se aplican con `supabase db push`. Se editaron las secciones 3, 5.3, 5.4, 13, 14.1 y 14.2 del spec.
- **Refs de Supabase.** `finance-dev` = `hkmcsipnkajwkyushjcu` (eu-central-1), vinculado el 2026-09-24. `finance` (producción) = `acgzwoauxxnbnttpgdas` (eu-west-1): no se vincula ni se toca hasta la Fase 7.

## Ajustes al spec ya aplicados (2026-09-24)

- **TWR (§6.5), aprobado por Felipe.** `r_t = (V_t − F_t) / V_{t−1} − 1` corresponde a un flujo a **fin** de día; el spec dice "el flujo ocurre al inicio del día" y además divide por 0 el primer día. Ejemplo: base 1000, depósito de 500 al inicio y +10% ese día → `V_t = 1650`. La fórmula anterior daba 15%; con flujo al inicio lo correcto es `V_t / (V_{t−1} + F_t) − 1 = 10%`. El spec ya tiene la fórmula corregida; se implementa en la Fase 5. A definir entonces: si la base `V_{t−1} + F_t` es 0 (por ejemplo, tras retirar todo el capital), ese día no aporta rendimiento.

## Desvíos menores del spec en la Fase 1

- **`external_id`**: clave canónica legible (`delta:fecha|way|símbolo|base|quote`) en vez de un hash. La deduplicación es equivalente, no depende de `node:crypto` y se puede depurar a simple vista. Además, las filas idénticas dentro de un mismo archivo llevan sufijo `#2`, `#3`…: sin él, dos ejecuciones idénticas (misma fecha, cantidad y total) colapsarían por la restricción `unique (account_id, source, external_id)`.
- **Precio del importador** redondeado a 8 decimales (`ROUND_HALF_UP`), igual que la columna `numeric(20,8)`: lo que se prueba es lo que se guarda.
- **El motor devuelve `issues` en vez de lanzar** (errores y advertencias tipados). La lectura sigue mostrando el dashboard aunque haya datos malos; el alta y la edición rechazan la operación si aparece un `error` nuevo.
- **`Position` es solo el libro mayor** (cantidad, costo, realizado, dividendos). Los campos de mercado (`market_value`, `unrealized_*`, `day_change`, `weight`) llegan en la Fase 4 como `ValuedPosition` en `valuation.ts`.
- **`NEGATIVE_CASH` se evalúa sobre el saldo final**, no en cada paso: en el CSV de Delta del fixture la compra de MELI (2026-06-11 17:27:49Z) deja el efectivo en −1218.995 hasta que entra el depósito de 3600 a las 17:28:41Z. Por lo mismo, el motor nunca bloquea una compra por falta de efectivo.
- **Contrato común de importación.** `parseDeltaCsv` devuelve `ImportParseResult` (no `DeltaParseResult`): el mismo contrato lo usará el importador de IBKR. Suma un campo `fatal` para los problemas del archivo entero (`EMPTY_FILE`, `MISSING_COLUMNS`), y `row` es el número de registro con el encabezado como fila 1. Solo se exigen las 10 columnas que se usan de las 16 del export.
- **`toEngineTransactions`** vive en su propio archivo (`lib/importers/to-engine.ts`) porque no es específico de Delta.
- **`vitest.config.mts`** en vez de `.ts`: evita el aviso de Vite por sintaxis ESM en un paquete CommonJS.
- **Tests con modelo independiente.** Además de los vectores calculados a mano y el test de aceptación, `invariants.test.ts` contrasta el motor contra un modelo que lleva el costo promedio con otra aritmética (fast-check, 300 historiales aleatorios por propiedad) y verifica la conservación del capital. Se comprobó por mutación (7 roturas deliberadas del motor y del importador) que los tests las detectan.

## Ajustes al spec en la Fase 2 (2026-09-24)

Se editaron las secciones 3, 5.4, 11, 13 y 14.1 del spec (aprobado en el plan de la Fase 2):

- **Registro por invitación con tabla y hook.** La lista vive en `public.allowed_emails` y la consulta el hook "Before User Created" de Supabase Auth; `ALLOWED_EMAILS` deja de ser una variable de entorno.
- **Nombres de las variables de Supabase:** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY` (claves `sb_publishable_…` / `sb_secret_…`; las legacy `anon` / `service_role` se deprecan a fin de 2026).
- **Next 16:** el antiguo `middleware` se llama `proxy.ts`.

## Desvíos de la Fase 2 respecto del esquema del §5.1

Las migraciones de `supabase/migrations/` son la fuente de verdad del esquema. Difieren del SQL del spec en:

- **FK compuestas** `(hijo, user_id) → (padre, user_id)` en `accounts`, `transactions`, `watchlist_items` e `imports`, con `unique (id, user_id)` en los padres. Con FK simples un usuario podría colgar filas propias de la cuenta o el portafolio de otro (el chequeo de una FK ignora RLS). Lo cubren los tests de integración.
- **`transactions.seq bigint generated always as identity`** + índice `(account_id, executed_at, created_at, seq)`: desempate estable (todas las filas de una importación comparten `created_at`).
- **CHECK por tipo de transacción** (con `is true` para que un campo NULL no pase), `fee = 0` fuera de BUY/SELL, formato de moneda y de símbolo, y valores válidos de `source`, `cost_method`, `type`. Reflejan la unión discriminada del motor.
- **`imports.account_id` pasa a NULL** al borrar la cuenta (`on delete set null (account_id)`), en vez de impedir el borrado: se conserva el historial de importaciones.
- **`corporate_actions.instrument_id` es NOT NULL** y `corporate_actions` valida `ratio > 0` (SPLIT) o `amount > 0` (DIVIDEND).
- **Políticas de `profiles`:** solo `select` y `update` (de `display_name` y `base_currency`, con permiso por columna). Se crea por trigger y se borra en cascada con el usuario, así que no lleva `insert` ni `delete`.
- **Privilegios por defecto revocados** para `anon` y `authenticated` en `public` (solo para objetos creados por `postgres`; los de `supabase_admin` no se tocan) y `GRANT` explícitos y mínimos por tabla. Las tablas de mercado son de solo lectura para `authenticated`.
- **Datos iniciales por trigger** (`handle_new_user`): cada usuario nuevo recibe perfil, "Portafolio principal", "Cuenta principal" (USD, costo promedio) y una watchlist.
- **`allowed_emails`** con RLS activado y sin políticas: nadie la lee ni la escribe por la Data API; el hook la consulta como `security definer`.

## Desvíos de la Fase 2 respecto del plan aprobado

- **Sin plantilla de correo propia:** el plan Free con el correo por defecto de Supabase rechaza modificar plantillas (`config push` respondió 400, sin aplicar nada). El ingreso usa el flujo **PKCE** (`/auth/callback` canjea el `code`) con el enlace estándar, en lugar de `token_hash` + página con botón "Continuar". Consecuencias: el enlace tiene que abrirse en el mismo navegador donde se pidió, y no hay defensa contra los escáneres de correo que pre-cargan enlaces. **No sirve para la PWA en iPhone** (el enlace abre Safari): antes de la Fase 6 hace falta SMTP propio y una plantilla con código (OTP) o `token_hash`.
- **`lib/db/client.ts` (cliente de navegador)** no se creó: ningún Client Component lo usa todavía. Se agrega cuando haga falta.
- **`supabase/config.toml` recortado** a lo que se gestiona (site URL, redirecciones, hook). `config diff` mostró que la plantilla de `init` pisaba 13 ajustes reales del proyecto.
- **`pnpm db:*` con guarda:** `scripts/assert-dev-linked.mjs` se niega a operar si el proyecto vinculado no es `finance-dev` (refs en `supabase/projects.json`). La CLI de Supabase pasa a devDependency fijada (2.117.0) y `pnpm-workspace.yaml` permite su postinstall.
- **Mensaje genérico en el login:** el email no habilitado recibe la misma respuesta que uno habilitado, para no revelar quién tiene acceso. Un `?error=` de la URL solo se acepta si es una clave propia conocida (`?error=constructor` daba 500).
- **Arreglo del CI heredado de la Fase 0:** `pnpm typecheck` fallaba en un checkout limpio porque `app/layout.tsx` usaba el tipo global `LayoutProps`, que genera Next. Ahora el layout tiene un tipo explícito y `typecheck` corre `next typegen` antes de `tsc`.
- **Tests de integración verificados por mutación:** con RLS desactivado en `transactions`, 5 tests fallan; se restauró y volvieron a pasar.

## Observaciones del spec para fases posteriores

1. **Splits y precios (Fases 3 y 5).** El `close` de Yahoo viene ajustado por splits de forma retroactiva, así que un `prices_daily` cacheado queda inconsistente tras un split: hay que re-hacer el backfill del instrumento al detectarlo y valuar el histórico con cantidades coherentes con ese ajuste. El motor aplica solo transacciones `SPLIT`; `corporate_actions` informa o propone splits, pero no se aplican dos veces.
2. **Orden estable en la base (§6.1).** Hecho en la Fase 2 (`transactions.seq`): al leer, ordenar por `(executed_at, created_at, seq)`.
3. **Importación atómica (§8.2, Fase 4).** "Insertar en una sola transacción de base de datos" entre `instruments`, `transactions` e `imports` requiere una función Postgres (RPC): supabase-js no abre transacciones de varias sentencias. Además, los usuarios no pueden escribir en `instruments` (solo `service_role`): una función `ensure_instruments` `security definer`, con validación de símbolos, evita usar la clave secreta en cada importación.
4. **Precisión de `numeric` (Fase 4).** PostgREST devuelve los `numeric` como números JSON y supabase-js los parsea como floats de JS. Los montos de este proyecto caben, pero para no depender de eso conviene leerlos como texto (`quantity::text`) y convertirlos con `d()`.
5. **SMTP propio (antes de invitar a alguien y antes de la Fase 6).** Ver "Desvíos de la Fase 2": correo por defecto limitado, sin plantillas, y flujo PKCE que no sirve en la PWA de iPhone.
6. **Token y claves de Supabase.** El token de la CLI es de toda la cuenta (incluye producción): revocarlo cuando no haga falta. Rotar la clave secreta si alguna vez se expone.
7. **Cabeceras de seguridad (antes del deploy, Fase 7).** `@supabase/ssr` guarda la sesión en cookies que el navegador puede leer, así que un XSS podría robarlas. Definir en `next.config.ts` una CSP estricta (sin scripts de terceros, coherente con "sin analytics" del spec), `frame-ancestors 'none'`, `Referrer-Policy` y `Permissions-Policy`. En producción, las redirecciones permitidas de Auth deben ser solo la URL de producción (hoy `http://localhost:3000/**`, que es de desarrollo).
8. **Privacidad.** El repositorio es público: nunca commitear historial real de inversiones, capturas de un portafolio real ni datos de `finance-dev`. Las imágenes del README salen de una cuenta demo temporal que se borra al terminar.
