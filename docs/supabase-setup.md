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

`pnpm test:integration` crea usuarios de prueba (`rls-*@example.com`, por la API de administración: no se envía ningún correo), prueba el aislamiento entre ellos y el rechazo de emails no habilitados, y borra todo al terminar. Se niegan a correr si el proyecto de `.env.local` no es `finance-dev`. Si un test se corta a mitad de camino pueden quedar usuarios `rls-*@example.com`: se borran desde Authentication → Users. No corren en el CI.

## Pausa por inactividad

Un proyecto Free se pausa tras una semana con poca actividad (ver `docs/limits.md`). Si `finance-dev` está pausado, restaurarlo desde el dashboard antes de correr `db:push` o los tests de integración.
