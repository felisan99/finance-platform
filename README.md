# Portfolio Tracker

Web app personal para seguir un portafolio de inversiones (acciones y ETFs de EE.UU.), con costo de operación cero. La especificación completa está en [`PROJECT_SPEC.md`](PROJECT_SPEC.md); las decisiones que se apartan del spec, en [`docs/decisions.md`](docs/decisions.md).

Estado: Fases 0 a 6 hechas (motor de cálculo puro, importador de Delta, base de datos y acceso por invitación con **código de 6 dígitos por email**, datos de mercado y crons de precios, interfaz principal: Inicio con el rendimiento —TWR, XIRR y comparación con el S&P 500— y la composición del portafolio, Posiciones, Actividad, importación de CSV, **Watchlist** y **app instalable (PWA)** con pantalla sin conexión). Falta la prueba en un iPhone real y la Fase 7 (producción). Para probarla a mano: [`docs/comprobacion-manual.md`](docs/comprobacion-manual.md). Hay un despliegue en Vercel apuntando a la base de desarrollo (ver `docs/decisions.md`, Fase 6).

## Empezar

Requiere Node 22 y pnpm.

```bash
pnpm install
cp .env.example .env.local   # completar con las claves de finance-dev (ver docs/supabase-setup.md)
pnpm dev                     # http://localhost:3000
```

## Comandos

| Comando                 | Qué hace                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm test`             | Tests unitarios (motor, importador, reglas de acceso)                                        |
| `pnpm test:integration` | RLS y registro contra `finance-dev` (necesita `.env.local`)                                  |
| `pnpm test:live`        | Cron contra Yahoo real y la app por HTTP con sesión real (a mano; antes `pnpm build`)        |
| `pnpm lint`             | ESLint (incluye las reglas que mantienen puro a `lib/engine`)                                |
| `pnpm typecheck`        | `next typegen` + `tsc --noEmit`                                                              |
| `pnpm build`            | Build de producción                                                                          |
| `pnpm db:push`          | Aplica las migraciones a `finance-dev`                                                       |
| `pnpm db:types`         | Regenera `lib/db/database.types.ts`                                                          |
| `pnpm db:config-diff`   | Diferencias de Auth entre `supabase/config.toml` y `finance-dev` (antes de un `config push`) |

Supabase se usa solo en la nube (sin Docker): [`docs/supabase-setup.md`](docs/supabase-setup.md) explica entornos, claves, cómo habilitar a alguien y qué limitaciones tiene el plan gratuito.

## Datos

`lib/engine/__fixtures__/delta_export.csv` es un export de Delta de ejemplo para los tests.
