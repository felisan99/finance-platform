# Supabase: entornos, claves y operación

## Entornos

|           | Desarrollo                                      | Producción                        |
| --------- | ----------------------------------------------- | --------------------------------- |
| Proyecto  | `finance-dev`                                   | `finance`                         |
| Ref       | `hkmcsipnkajwkyushjcu`                          | `acgzwoauxxnbnttpgdas`            |
| Región    | eu-central-1                                    | eu-west-1                         |
| Se usa en | `.env.local`, `pnpm db:*`, tests de integración | Fase 7 (Vercel). No se toca antes |

Los refs están en `supabase/projects.json`, que leen `scripts/assert-dev-linked.mjs` y los tests de integración para negarse a operar sobre cualquier otro proyecto. No hay Supabase local ni Docker.

## Claves

- **Publicable** (`sb_publishable_…`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Es pública por diseño; los datos los protege RLS.
- **Secreta** (`sb_secret_…`) → `SUPABASE_SECRET_KEY`. Salta RLS: solo en el servidor, nunca en el chat, el repo ni el CI. Se copia del dashboard (Project Settings → API Keys) o con `pnpm supabase projects api-keys --project-ref <ref> --reveal` (sin `--reveal` la CLI la devuelve enmascarada).
- Las claves legacy `anon` / `service_role` se deprecan a fin de 2026; el proyecto usa las nuevas.
- El token de la CLI (`supabase login`) da acceso a **toda** la cuenta, incluido producción. Revocarlo cuando no haga falta: dashboard → Account → Access Tokens.

## Comandos

| Comando                                              | Qué hace                                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:push`                                       | Aplica las migraciones pendientes a `finance-dev` (`--dry-run` para ver cuáles). No necesita contraseña de la base: la CLI usa un rol temporal por la Management API |
| `pnpm db:types`                                      | Regenera `lib/db/database.types.ts` desde el esquema real                                                                                                            |
| `pnpm db:config-diff`                                | Muestra diferencias entre `supabase/config.toml` y la configuración remota (solo lectura)                                                                            |
| `pnpm supabase config push`                          | Aplica lo declarado en `config.toml`. **Antes, siempre `db:config-diff`**                                                                                            |
| `pnpm supabase db query --linked "select …"`         | Consulta SQL por la Management API                                                                                                                                   |
| `pnpm supabase db advisors --linked --type security` | Revisión de seguridad (RLS, funciones expuestas…)                                                                                                                    |
| `pnpm test:integration`                              | Aislamiento entre usuarios y registro por invitación, contra `finance-dev`                                                                                           |
| `pnpm test:live`                                     | Aceptación de la Fase 3: el cron real contra Yahoo real y `finance-dev` (no va al CI)                                                                                |

`supabase db reset --linked` borra la base remota: solo con pedido explícito y nunca en `finance`.

## Registro por invitación

La lista de quiénes pueden tener cuenta es la tabla `public.allowed_emails`. El hook "Before User Created" de Supabase Auth (activado en `config.toml`) la consulta cuando alguien intenta crear un usuario y rechaza con 403 a los que no están.

Habilitar a alguien (email en minúsculas y sin espacios, lo exige un CHECK):

```sql
insert into public.allowed_emails (email, note) values ('amigo@ejemplo.com', 'amigo');
```

Se puede ejecutar con `pnpm supabase db query --linked "…"` o desde el Table Editor del dashboard.

- Quitar un email de la lista **no** borra al usuario que ya existe: el hook solo corre al crear. Para revocar el acceso hay que borrar el usuario en Authentication → Users.
- El hook no alcanza al alta por la API de administración (`auth.admin.createUser`, "Add user" del dashboard): esos usuarios se crean sin pasar por la lista. Los tests de integración lo usan.
- Si el hook se apagara, el registro quedaría abierto. Lo cubre `signup-gate.integration.test.ts`.

## Datos de mercado y crons (Fase 3)

- `/api/cron/daily-prices` (programado en `vercel.json`, `0 22 * * 1-5`) y `/api/cron/backfill` (manual). Exigen `Authorization: Bearer ${CRON_SECRET}` y fallan cerrado (500) si `CRON_SECRET` falta o tiene menos de 32 caracteres. Generar con `openssl rand -hex 32`. En Vercel, con la variable definida, el cron envía el header solo.
- Probar a mano en desarrollo (sin imprimir el secreto en pantalla ni en el historial compartido): `curl -H "Authorization: Bearer $(grep ^CRON_SECRET .env.local | cut -d= -f2)" http://localhost:3000/api/cron/daily-prices`.
- **`market_job_runs`** es el registro de las corridas (solo el servidor la lee y la escribe). Para ver las últimas:

  ```sql
  select job, status, started_at, finished_at, summary, errors
  from public.market_job_runs order by started_at desc limit 10;
  ```

  `status`: `ok`, `partial` (algún instrumento o cotización falló), `error` (falló todo) o `running`. Una corrida que quedó `running` más de 15 minutos se cierra sola como `error` en la corrida siguiente. `errors` lista cada problema con su etapa (`backfill`, `prices`, `quotes`, `profile`, `run`) y el símbolo.

- **`active_instruments()`** devuelve los instrumentos con transacciones o en alguna watchlist (de cualquier usuario) **y el benchmark de todo portafolio con operaciones** (`SPY` por defecto, sembrado por la migración `benchmark_history`), con su primera fecha (la del portafolio, para el benchmark), `history_from` y último precio. Solo la puede llamar `service_role`.
- Un instrumento nuevo se descarga solo: el próximo cron lo ve sin historial y lo baja desde su primera transacción (menos 7 días), o 5 años atrás si solo está en una watchlist.
- Para forzar que un instrumento se vuelva a descargar completo: `update public.instruments set history_backfilled_at = null where symbol = 'VOO';` (el próximo cron lo hace).
- **Leer series largas de `prices_daily` por páginas o con `price_series`**: PostgREST corta cada respuesta en 1000 filas y cinco años de un instrumento son ~1260 (ver `docs/decisions.md`, observación 9). Varias series juntas van con el RPC `price_series`, una fila por instrumento.
- El advisor de seguridad puede avisar `auth_leaked_password_protection`: es de plan Pro y no aplica (la app no usa contraseñas).

## Funciones de la app (Fases 4 y 6)

- **`import_transactions(p_account_id, p_source, p_filename, p_rows, p_report)`**: importación atómica (una llamada = una transacción). `security invoker`: RLS y las FK compuestas protegen (no se puede importar a la cuenta de otro). Devuelve `(import_id, inserted, duplicates)`. Los instrumentos ya tienen que existir (los da de alta el servidor con la clave secreta). Máximo 5000 filas por llamada. Acepta los orígenes `delta_csv`, `csv` (formato simple) e `ibkr_flex` y deja en cada transacción el `import_id` de su importación. Para ver lo importado: `select filename, rows_total, rows_imported, rows_skipped, report, created_at from public.imports order by created_at desc;`.
- **`undo_import(p_import_id)`** y **`recent_imports(p_limit)`** (importación v2, `security invoker`): la primera borra las transacciones ligadas a una importación y la marca con `imports.undone_at` (devuelve cuántas borró; falla si no es del usuario o ya está deshecha); la segunda lista las últimas importaciones con cuántas transacciones les quedan. Antes de deshacer, el servidor valida que el libro siga consistente (`validateLedgerChange`). Las importaciones anteriores a la migración `20260925161500_csv_import_undo.sql` no tienen `import_id`.
- **`instrument_prices(p_instrument_ids)`**: último y penúltimo cierre de hasta 500 instrumentos, en texto (sin pasar por floats).
- **`take_rate_limit(p_key)`**: límites de uso por usuario. La política vive en la función: `refresh_quotes` 1 cada 5 minutos, `search_symbols` 30 por minuto, `import_csv` 20 por hora. Para cambiarla se edita la función en una migración nueva. La tabla `rate_limits` no es accesible para los usuarios.
- **Advisor de seguridad:** avisa que `take_rate_limit` es `security definer` y `authenticated` puede ejecutarla. Es intencional (ver `docs/decisions.md`, Fase 4). El otro aviso (`auth_leaked_password_protection`) es de plan Pro y no aplica.
- **`watchlist_market(p_instrument_ids, p_since, p_points)`** (Fase 6): por instrumento, último y penúltimo cierre, mínimo y máximo de cierres desde `p_since` y los últimos `p_points` cierres, en texto (hasta 100 instrumentos, `security invoker`). El trigger `watchlist_items_limit` limita cada watchlist a 50 símbolos.
- **`take_login_attempt(p_key)` y `clear_login_attempts(p_key)`** (Fase 6): límite de intentos del código de ingreso, solo `service_role` (ver "Ingreso con código").
- **Crear migraciones con `supabase migration new` en una terminal sin TTY:** agregar `< /dev/null`, si no la CLI espera datos por stdin y se cuelga.

## Ingreso con código (OTP) y SMTP propio

Flujo: `/login` (email) → `signInWithOtp` → correo con un **código de 6 dígitos** → `/login` (código) → `verifyOtp({ email, token, type: "email" })` → sesión en las cookies. No hay enlace ni ruta de retorno: sirve igual dentro de la app instalada en el iPhone (sus cookies son aparte de las de Safari).

- **SMTP:** Gmail dedicado con contraseña de aplicación. En el panel de Supabase: _Authentication → Emails → SMTP Settings_ → host `smtp.gmail.com`, puerto `465`, usuario = la dirección completa, remitente = la misma dirección, nombre del remitente a gusto (es lo que se ve en la bandeja de entrada). **La contraseña de aplicación se carga solo en el panel**, nunca en el repo ni en el chat. Requisitos de Gmail: verificación en dos pasos y una cuenta que no sea la personal (la contraseña de aplicación da acceso a toda la cuenta). El bloque SMTP **no** está en `supabase/config.toml`: un `config push` no la pisa. Con SMTP propio Supabase fija 30 correos por hora en total (`rate_limit.email_sent`); Gmail permite ~500 por día.
- **Qué se versiona** (`supabase/config.toml`): `otp_length = 6` (tiene que coincidir con `CODE_LENGTH` de `lib/validation/login.ts`), `otp_expiry = 600` (10 minutos), `max_frequency = "1m0s"` (espera mínima entre dos correos al mismo email; el botón "Reenviar" espera lo mismo) y las plantillas `magic_link` y `confirmation` (`supabase/templates/*.html`, solo el código). Supabase usa una u otra según el email ya exista o sea un alta nueva. Después de cambiar algo: `pnpm db:config-diff`, revisar, y recién entonces `pnpm exec supabase config push`.
- **Duración de la sesión:** no vence sola (cookies de 400 días, sin tope ni cierre por inactividad). El token de acceso dura 1 semana (`jwt_expiry = 604800` en `config.toml`, aplicado en `finance-dev` y en `finance`): con 1 hora, una renovación perdida en el teléfono hacía que Supabase revocara la sesión por "reuso" del refresh token (ver `docs/decisions.md`, 2026-09-28). Cerrar sesión no invalida el token de acceso ya emitido hasta que vence.
- **Límite de intentos de verificación** (antes de tener sesión): tabla `login_attempts` y funciones `take_login_attempt` / `clear_login_attempts`, solo ejecutables por `service_role`. La política (5 verificaciones por 15 minutos por email, clave = SHA-256 del email) vive en la función. Si alguien queda bloqueado por error: `delete from public.login_attempts;`.
- **Un email sin acceso** (fuera de `allowed_emails`) recibe la misma respuesta que uno con acceso: el hook "Before User Created" responde 403 y no se manda ningún correo. Un usuario que ya existe y se sacó de la lista sigue pudiendo pedir un código: para quitar el acceso de verdad hay que borrar el usuario (Authentication → Users) además de la fila de `allowed_emails`.
- **Plan B si el correo falla** (Gmail bloquea el envío, cuota agotada, correo en spam): generar el código con la clave secreta, sin enviar nada, y escribirlo en `/login`. Con la clave en `.env.local`, desde la raíz del repo:

  ```bash
  node -e '
  const { parseEnv } = require("node:util");
  const env = parseEnv(require("node:fs").readFileSync(".env.local", "utf8"));
  const { createClient } = require("@supabase/supabase-js");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  admin.auth.admin.generateLink({ type: "magiclink", email: "tu@email.com" })
    .then(({ data, error }) => console.log(error ? error.message : data.properties.email_otp));
  '
  ```

  Vale 10 minutos y sirve una vez. En `/login` escribí tu email, tocá **Ya tengo un código** (salta al segundo paso sin pedir otro correo) y escribí el código.

- **Los correos de Auth con el proveedor por defecto** (sin SMTP propio) están limitados a 2 por hora, solo a miembros de la organización y sin plantillas editables (400 "Email template modification is not available…"): no sirven para invitar a nadie. Repetir la configuración de SMTP en `finance` en la Fase 7.
- Límites de Auth: 60 segundos entre pedidos para el mismo email y 30 correos por hora en total.

## Configuración de Auth como código

`supabase/config.toml` **no** es la plantilla de `supabase init`: declara solo lo que gestionamos (URL del sitio y redirecciones —ya sin uso, los correos no llevan enlaces—, el hook de registro, el largo, el vencimiento y la frecuencia del código y las plantillas de correo). Lo que no está declarado no se toca (`config push` ya no devuelve a su valor por defecto lo no declarado). La plantilla completa de `supabase init` **no** se debe usar: un `config push` con ella pisaba ajustes reales del proyecto. **Regla:** `pnpm db:config-diff` y revisar el diff antes de cualquier `config push` (sin TTY la CLI aplica los cambios sin preguntar).

## Base de datos

- Migraciones en `supabase/migrations/`, una por cambio. Regla: cada tabla nueva lleva sus `GRANT` y su RLS; los privilegios por defecto de `public` están revocados para `anon` y `authenticated`.
- `service_role` (clave secreta) conserva sus privilegios y salta RLS.
- Los tipos de `lib/db/database.types.ts` se regeneran con `pnpm db:types` después de cada migración.

## Tests de integración

`pnpm test:integration` crea usuarios de prueba (`rls-*@example.com`, por la API de administración: no se envía ningún correo), prueba el aislamiento entre ellos y el rechazo de emails no habilitados, y borra todo al terminar. Se niegan a correr si el proyecto de `.env.local` no es `finance-dev`. Si un test se corta a mitad de camino pueden quedar usuarios `rls-*@example.com`, instrumentos de prueba (símbolo `ZT` + 6 hexadecimales) y filas de `market_job_runs`: los usuarios se borran desde Authentication → Users (sus transacciones se van en cascada), y después:

```sql
delete from public.instruments where symbol ~ '^ZT[0-9A-F]{6}$';  -- precios, cotizaciones y acciones en cascada
delete from public.market_job_runs;                                  -- solo mientras no haya corridas reales
delete from public.rate_limits;                                      -- contadores de uso de los usuarios de prueba (también se borran con el usuario)
```

Si Supabase Auth está degradado (llamadas de 20 a 40 s, se vio el 2026-09-24) la suite se cuelga: mirar status.supabase.com antes de re-correrla. Los tests de `lib/market-jobs` no inician sesión (solo la clave secreta), así que dependen menos de Auth. No corren en el CI.

## Pausa por inactividad

Un proyecto Free se pausa tras una semana con poca actividad (ver `docs/limits.md`). Si `finance-dev` está pausado, restaurarlo desde el dashboard antes de correr `db:push` o los tests de integración.
