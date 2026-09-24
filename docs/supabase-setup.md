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
- **Leer series largas de `prices_daily` por páginas**: PostgREST corta cada respuesta en 1000 filas y cinco años de un instrumento son ~1260 (ver `docs/decisions.md`, observación 9).
- El advisor de seguridad puede avisar `auth_leaked_password_protection`: es de plan Pro y no aplica (la app no usa contraseñas).

## Funciones de la app (Fase 4)

- **`import_transactions(p_account_id, p_source, p_filename, p_rows, p_report)`**: importación atómica (una llamada = una transacción). `security invoker`: RLS y las FK compuestas protegen (no se puede importar a la cuenta de otro). Devuelve `(import_id, inserted, duplicates)`. Los instrumentos ya tienen que existir (los da de alta el servidor con la clave secreta). Máximo 5000 filas por llamada. Para ver lo importado: `select filename, rows_total, rows_imported, rows_skipped, report, created_at from public.imports order by created_at desc;`.
- **`instrument_prices(p_instrument_ids)`**: último y penúltimo cierre de hasta 500 instrumentos, en texto (sin pasar por floats).
- **`take_rate_limit(p_key)`**: límites de uso por usuario. La política vive en la función: `refresh_quotes` 1 cada 5 minutos, `search_symbols` 30 por minuto, `import_csv` 20 por hora. Para cambiarla se edita la función en una migración nueva. La tabla `rate_limits` no es accesible para los usuarios.
- **Advisor de seguridad:** avisa que `take_rate_limit` es `security definer` y `authenticated` puede ejecutarla. Es intencional (ver `docs/decisions.md`, Fase 4). El otro aviso (`auth_leaked_password_protection`) es de plan Pro y no aplica.
- **Crear migraciones con `supabase migration new` en una terminal sin TTY:** agregar `< /dev/null`, si no la CLI espera datos por stdin y se cuelga.

## Ingreso con enlace (magic link)

Flujo PKCE: `/login` → `signInWithOtp` → correo con el enlace de Supabase → `/auth/callback?code=…` → sesión.

- **El enlace tiene que abrirse en el mismo navegador donde se pidió**: la cookie con el "code verifier" vive ahí. Si no, la app muestra "El enlace no funcionó…".
- **iPhone con la PWA instalada (Fase 6):** el enlace del correo abre Safari, no la app instalada, así que este flujo no alcanza. Hará falta SMTP propio y una plantilla con código de un solo uso (OTP) o con `token_hash`.
- **Correo por defecto de Supabase:** 2 mensajes por hora, solo a miembros de la organización y sin poder editar las plantillas (el plan Free responde 400 "Email template modification is not available…"). Sirve para vos en desarrollo; **antes de invitar a un amigo hay que configurar SMTP propio** (Authentication → SMTP Settings). La doc de Supabase menciona Resend, Brevo, AWS SES, Postmark, SendGrid y ZeptoMail: revisar sus planes gratuitos.
- Límites de Auth: 60 segundos entre pedidos para el mismo usuario y 30 pedidos cada 5 minutos por IP.

## Configuración de Auth como código

`supabase/config.toml` **no** es la plantilla de `supabase init`: declara solo lo que gestionamos (URL del sitio, redirecciones permitidas y el hook de registro). Lo que no está declarado no se toca. La plantilla completa pisaba ajustes reales del proyecto (site URL, confirmación de email, largo del OTP, pooler) y, sin TTY, `config push` aplica sin preguntar.

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
