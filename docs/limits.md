# Límites de los planes gratuitos

Verificado el **2026-09-23** en las páginas oficiales citadas al pie. Estos límites cambian: volver a revisarlos antes de la Fase 3 (crons y proveedores de datos) y de la Fase 7 (deploy).

## Vercel — plan Hobby

| Tema                           | Límite                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cron jobs                      | 100 por proyecto. **Mínimo una ejecución por día**; una expresión que corra más de una vez al día hace fallar el deploy.                                        |
| Precisión del cron             | Por hora (±59 min): `0 22 * * 1-5` corre en algún momento entre las 22:00 y las 22:59 UTC.                                                                      |
| Uso permitido                  | Solo personal y no comercial (fair use guidelines).                                                                                                             |
| Duración máxima de una función | 300 s                                                                                                                                                           |
| Incluido por mes               | 1.000.000 de invocaciones · 4 CPU-hrs de Active CPU · 360 GB-hrs de memoria · 100 GB de Fast Data Transfer                                                      |
| Otros                          | 100 deployments por día · logs de runtime de 1 hora · en la mayoría de los casos, si se excede un límite hay que esperar 30 días para volver a usar esa función |

Implicancias para el proyecto:

- Un único cron diario (`/api/cron/daily-prices`), después del cierre de Nueva York; el backfill de instrumentos pendientes va dentro de la misma ejecución (spec §7.2). No hay reintentos ni frecuencia intradiaria.
- Si algún día hace falta más frecuencia, la alternativa del spec es GitHub Actions con `schedule:` llamando al endpoint.

## Supabase — plan Free

| Tema                       | Límite                                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proyectos activos          | 2 (los pausados no cuentan). `finance-dev` + `finance` entran justo.                                                                                                                    |
| Pausa por inactividad      | Se pausa el proyecto tras 1 semana con poca actividad en la base. "Unas pocas requests a la base por día" durante la semana alcanzan para evitarlo. Se avisa por email antes de pausar. |
| Restauración               | Un proyecto pausado se puede restaurar desde el dashboard hasta 1 año después de la pausa.                                                                                              |
| Base de datos              | 500 MB                                                                                                                                                                                  |
| Usuarios activos mensuales | 50.000                                                                                                                                                                                  |
| Egress                     | 5 GB (y 5 GB de egress cacheado)                                                                                                                                                        |
| Storage                    | 1 GB, con archivos de hasta 50 MB                                                                                                                                                       |
| Edge Functions             | 500.000 invocaciones                                                                                                                                                                    |
| Realtime                   | 200 conexiones simultáneas · 2 millones de mensajes                                                                                                                                     |
| Data API (PostgREST)       | **Máximo 1000 filas por respuesta** (observado el 2026-09-24: un `select` pedido con `limit(5000)` devolvió 1000). Hay que paginar con `range`; ver `docs/decisions.md`, observación 9. |

Implicancias para el proyecto:

- **`finance-dev` se pausa si pasa una semana sin usarlo.** Antes de `supabase link` / `supabase db push` o de correr los tests de integración hay que restaurarlo desde el dashboard si está pausado.
- `finance` (producción): el cron diario genera actividad en la base y evita la pausa (spec §7.2). Confirmarlo después del primer deploy.
- Registrar la fecha de la última actividad de `finance-dev` cuando pase mucho tiempo entre fases.

## GitHub Actions

- GitHub Free: **2.000 minutos por mes** y 500 MB de artefactos en repositorios privados con runners estándar de GitHub. Los repositorios públicos usan runners estándar gratis.
- El CI de este proyecto (lint + typecheck + test) tarda pocos minutos por corrida: entra con holgura.

## Proveedores de datos de mercado

| Proveedor                   | Estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yahoo (`yahoo-finance2` v4) | **No oficial.** El README dice: "neither created nor endorsed by Yahoo Inc. Yahoo does not provide any official API to developers, nor makes any guarantees regarding service availability or API consistency". Sin cuotas publicadas: tratarlo como best-effort (try/catch, validación con Zod, reintentos con backoff; spec §7.1). Requiere Node 22+ y se compromete a soportar Node 22 hasta 2027-04-30. Revisar los términos de uso de Yahoo antes de mostrar datos a terceros. |
| Twelve Data (plan Basic)    | 8 créditos de API por minuto y 800 por día. Incluye acciones y ETFs de EE.UU. en tiempo real. El plan se describe como "Internal non-display usage" y para fines "personal, internal, and non-commercial": **leer sus términos antes de mostrar precios en la UI**, aunque sea a amigos.                                                                                                                                                                                            |
| Finnhub (plan gratuito)     | **Sin verificar.** Su sitio se renderiza con JavaScript y no se pudo leer la cuota por minuto ni qué endpoints son gratuitos (en particular las velas históricas `/stock/candle`). Revisar a mano https://finnhub.io/pricing y https://finnhub.io/docs/api/rate-limit antes de implementar `FinnhubProvider`.                                                                                                                                                                       |

### Yahoo en la práctica (Fase 3, verificado el 2026-09-24)

- Respondió a 12 `chart` seguidos sin errores (70–400 ms cada uno); el cliente igual espacia los pedidos (2 a la vez, 150 ms de separación) y reintenta 429/5xx/red con backoff.
- Devuelve `close` nulo en algunos días hábiles, reajusta hacia atrás el historial en cada split y dividendo, y trae ruido de float32 en los precios: ver `docs/decisions.md`.
- `yahoo-finance2` 4.0.2 trae ~100 paquetes (incluye un SDK de MCP con express y hono que la app no usa). Sin scripts de instalación; `pnpm audit` sin vulnerabilidades conocidas.
- **Datos de la empresa y series intradía (2026-09-25):** `quoteSummary` (`summaryDetail`, `defaultKeyStatistics`, `earningsHistory`, `calendarEvents`) y `chart` de 30 min y 1 hora respondieron bien para GOOGL, AAPL, NVDA y VOO. Para un ETF, `earningsHistory` y `calendarEvents` fallan con «No fundamentals data found»: no se piden. Cada visita a una ficha puede sumar 2 consultas (datos y ganancias) y cada rango que se toca, 1; las cachea el servidor (1 hora y 5 minutos) y las limita `search_symbols` (30 por minuto por usuario). Yahoo ya sacó módulos de balances sin aviso en 2024: por eso todo campo es opcional.
- **Cripto (2026-09-28):** `search`, `quote`, `quoteSummary` y `chart` responden para `BTC-USD` y `ETH-USD`, con `quoteType` `CRYPTOCURRENCY` y bolsa `CCC`.
  - El historial viene en UTC (`exchangeTimezoneName: "UTC"`) con barras todos los días. La sesión «regular» es el día UTC entero, así que la barra del día en curso se descarta como la de una rueda abierta.
  - 5 años de BTC-USD son 1826 filas.
  - El cron corre de lunes a viernes: las barras del fin de semana entran el lunes (se relee una semana hacia atrás), y un fin de semana la cotización de hoy llega con «Actualizar precios».
- **No verificado:** que Yahoo no bloquee las IPs de datacenter de Vercel. Se comprueba en el deploy (Fase 7) corriendo el cron una vez y mirando `market_job_runs`.

### Next.js en Vercel (Fase 4)

- Una Server Action acepta hasta **1 MB** de cuerpo (`serverActions.bodySizeLimit`): por eso el CSV a importar se limita a 1 MB (el export de Delta del fixture pesa 7,7 KB).
- `after()` (descarga de precios tras importar) corre dentro de la duración máxima de la función (300 s en Hobby).

## Runtime

- Node 22 (`.nvmrc`): su soporte upstream termina el 2027-04-30 (fecha que menciona el README de `yahoo-finance2`). Planificar el salto a la siguiente LTS antes de esa fecha.

## Fuentes (consultadas el 2026-09-23)

- Vercel Cron Jobs — Usage & Pricing: https://vercel.com/docs/cron-jobs/usage-and-pricing (actualizada 2026-07-15)
- Vercel Hobby Plan: https://vercel.com/docs/plans/hobby (actualizada 2026-09-14)
- Supabase — Pricing: https://supabase.com/pricing
- Supabase — Project Pausing: https://supabase.com/docs/guides/platform/free-project-pausing
- GitHub Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- yahoo-finance2: https://github.com/gadicc/yahoo-finance2
- Twelve Data — Pricing: https://twelvedata.com/pricing
