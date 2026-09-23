# Portfolio Tracker

Web app personal para seguir un portafolio de inversiones (acciones y ETFs de EE.UU.), con costo de operación cero. La especificación completa está en [`PROJECT_SPEC.md`](PROJECT_SPEC.md); las decisiones que se apartan del spec, en [`docs/decisions.md`](docs/decisions.md).

Estado: Fases 0 a 2 hechas (motor de cálculo puro, importador de Delta, base de datos y acceso con enlace por email). La interfaz llega en la Fase 4.

## Empezar

Requiere Node 22 y pnpm.

```bash
pnpm install
cp .env.example .env.local   # completar con las claves de finance-dev (ver docs/supabase-setup.md)
pnpm dev                     # http://localhost:3000
```

## Comandos

| Comando                 | Qué hace                                                      |
| ----------------------- | ------------------------------------------------------------- |
| `pnpm test`             | Tests unitarios (motor, importador, reglas de acceso)         |
| `pnpm test:integration` | RLS y registro contra `finance-dev` (necesita `.env.local`)   |
| `pnpm lint`             | ESLint (incluye las reglas que mantienen puro a `lib/engine`) |
| `pnpm typecheck`        | `next typegen` + `tsc --noEmit`                               |
| `pnpm build`            | Build de producción                                           |
| `pnpm db:push`          | Aplica las migraciones a `finance-dev`                        |
| `pnpm db:types`         | Regenera `lib/db/database.types.ts`                           |

Supabase se usa solo en la nube (sin Docker): [`docs/supabase-setup.md`](docs/supabase-setup.md) explica entornos, claves, cómo habilitar a alguien y qué limitaciones tiene el plan gratuito.

## Datos

`lib/engine/__fixtures__/delta_export.csv` es un export de Delta de ejemplo para los tests.
