# Portfolio Tracker — Especificación del proyecto

> Documento de referencia para desarrollar el proyecto con Claude Code.
> Copialo a la raíz del repo como `PROJECT_SPEC.md` y referencialo desde `CLAUDE.md` (ver sección 14).
>
> **Ajuste 2026-09-23:** no se usa Supabase local (sin Docker). Se trabaja con dos proyectos en la nube: `finance-dev` (desarrollo) y `finance` (producción). Cambios en las secciones 3, 5.3, 5.4, 13, 14.1 y 14.2.
>
> **Ajuste 2026-09-24:** la fórmula del TWR (sección 6.5) se corrigió para que coincida con la convención de flujo al inicio del día. La anterior, `(V_t − F_t) / V_{t−1} − 1`, corresponde a un flujo a fin de día y divide por 0 el primer día.
>
> **Ajuste 2026-09-24 (Fase 2):** la lista de emails permitidos vive en la tabla `allowed_emails` (la consulta el hook "Before User Created" de Supabase Auth), no en una variable de entorno; y las variables de Supabase usan los nombres de las claves nuevas (`PUBLISHABLE_KEY`, `SECRET_KEY`). Cambios en las secciones 3, 5.4, 11, 13 y 14.1.
>
> **Ajuste 2026-09-24 (Fase 3):** `getDailyHistory` devuelve barras y eventos (splits/dividendos) de la misma respuesta; `instruments` suma `history_from`; hay una tabla `market_job_runs` (registro de corridas) y una función `active_instruments()`. Cambios en las secciones 5.2, 7.1 y 7.2; detalle en `docs/decisions.md`.
>
> **Ajuste 2026-09-24 (Fase 4):** navegación de 4 pestañas (la de Watchlist llega con la Fase 6), una sola cuenta, importación en dos pasos con función SQL atómica (§8.2), límites de uso por usuario en la base y "Actualizar precios" con límite de 1 cada 5 minutos (§7.2). Cambios en §8.2 y §10; detalle en `docs/decisions.md`.
>
> **Ajuste 2026-09-24 (composición):** la asignación de la sección 6.6 (por posición y por tipo, con el efectivo aparte) ya está en Inicio desde la Fase 4; la Fase 5 conserva la serie histórica, TWR, XIRR y benchmark. Detalle en `docs/decisions.md`.
>
> **Ajuste 2026-09-24 (Fase 5):** el benchmark (`SPY`) se siembra como instrumento y los jobs de precios lo mantienen (`active_instruments()` lo incluye); la serie histórica desajusta los splits con los `SPLIT` del libro; el XIRR se calcula solo desde 30 días. Convenciones en las secciones 6.4 y 6.5; detalle en `docs/decisions.md`.
>
> **Ajuste 2026-09-24 (requisito de la Fase 6):** el ingreso con enlace por email no sirve para la PWA en iPhone. Antes de la Fase 6 (y de invitar a nadie) hay que pasar a código OTP de 6 dígitos con SMTP propio. Cambio en la sección 14.2.
>
> **Ajuste 2026-09-25 (Fase 6):** el ingreso es por código de 6 dígitos (SMTP propio con Gmail dedicado, plantillas en el repo y un límite de 5 intentos por 15 minutos por email); la Watchlist tiene una función SQL de lectura (`watchlist_market`) y un tope de 50 símbolos; la PWA lleva un service worker mínimo (solo la pantalla sin conexión, sin caché de páginas ni datos), un último estado conocido guardado en el dispositivo y el modo oscuro sigue al sistema con CSS. Cambios en §10.4, §10.6, §11 y §14.2; detalle en `docs/decisions.md`.

---

## 1. Visión

Una web app personal para hacer seguimiento de un portafolio de inversiones (acciones y ETFs de EE.UU., broker Interactive Brokers; desde el 2026-09-28 también cripto en USD, en portafolios aparte), con métricas serias de rendimiento, instalable en el iPhone como PWA, con **costo de operación cero** y la posibilidad de compartirla con algunos amigos, cada uno con sus propios datos aislados.

### Objetivos
- Registrar todas las operaciones (compras, ventas, dividendos, depósitos, retiros, comisiones, splits) y derivar de ellas **posiciones, efectivo y métricas**. Las transacciones son la única fuente de verdad.
- Mostrar: valor total (posiciones + efectivo), ganancia no realizada y realizada, rendimiento ponderado por tiempo (TWR) comparado contra el S&P 500, rendimiento ponderado por dinero (XIRR), asignación por activo, dividendos y watchlist.
- Importar el historial desde el CSV exportado de **Delta** (formato en la sección 8) y, más adelante, desde **IBKR Flex Query**.
- Mobile-first, instalable en la pantalla de inicio del iPhone.
- Multiusuario simple: cada usuario ve solo sus datos (Row Level Security).

### No objetivos (por ahora)
- Ejecutar órdenes o conectarse al broker para operar.
- Precios en tiempo real: alcanza con el cierre diario más una cotización "reciente" con demora.
- Reportes impositivos.
- Opciones, futuros y cripto. El modelo debe permitir agregarlos después, pero no se implementan ahora.
- Uso comercial: el plan Hobby de Vercel no lo permite.

---

## 2. Restricciones

| Restricción | Implicancia |
|---|---|
| Costo cero | Vercel Hobby + Supabase Free + APIs de precios gratuitas. Todo servicio pago es opcional. |
| Uso no comercial | Compartirla con amigos gratis sí; cobrar o poner anuncios, no. |
| Bajo cómputo | Nada de procesos siempre prendidos: todo son funciones serverless y crons. |
| Límites de las APIs gratuitas | Guardar precios en caché en la base; nunca consultar la API externa en cada visita. |
| Datos de terceros | Mostrar precios a pocos usuarios de forma privada es aceptable; no exponer datos de mercado públicamente. |

> Los límites de los planes gratuitos (Vercel Cron, pausa por inactividad de Supabase, cuotas de las APIs) cambian con el tiempo. Verificarlos al empezar y documentarlos en `docs/limits.md`.

---

## 3. Stack técnico

- **Framework**: Next.js (App Router) + TypeScript en modo `strict`.
- **UI**: Tailwind CSS + shadcn/ui. Gráficos con Recharts.
- **Base de datos, auth y seguridad**: Supabase (Postgres + Supabase Auth con magic link por email + RLS).
- **Entornos de Supabase**: sin Supabase local (sin Docker). Dos proyectos en la nube: `finance-dev` (desarrollo) y `finance` (producción, Fase 7).
- **Cliente de base de datos**: `@supabase/ssr` para server components, route handlers y el proxy (el antiguo middleware; en Next 16 se llama `proxy.ts`).
- **Validación**: Zod para inputs, parsing de CSV y respuestas de APIs externas.
- **Datos de mercado**: `yahoo-finance2` (npm) detrás de una interfaz `MarketDataProvider`, con proveedor alternativo Finnhub o Twelve Data (API key gratuita).
- **CSV**: `papaparse`.
- **Fechas y números**: `date-fns` + `date-fns-tz`. Para dinero, `decimal.js` o enteros en centavos: **nunca floats para montos persistidos**.
- **Tests**: Vitest (unitarios del motor de cálculo) + Playwright (opcional, flujos principales).
- **PWA**: web app manifest + service worker simple (Serwist o un SW hecho a mano, mínimo).
- **Hosting**: Vercel (Hobby). Crons con Vercel Cron o, como alternativa, GitHub Actions.
- **Gestor de paquetes**: pnpm.

---

## 4. Arquitectura

```
[iPhone PWA / navegador]
        │
        ▼
[Next.js en Vercel]
  ├─ Server Components  → leen de Supabase (con RLS, sesión del usuario)
  ├─ Server Actions / Route Handlers → escrituras validadas con Zod
  ├─ /api/cron/*        → jobs protegidos con CRON_SECRET (usan service role)
  └─ lib/engine/*       → motor de cálculo PURO (sin I/O, 100% testeable)
        │
        ▼
[Supabase Postgres]  ← tablas de usuario (RLS) + tablas compartidas de mercado
        ▲
        │ cron diario
[MarketDataProvider] → Yahoo (principal) / Finnhub (alternativo)
```

### Principios
1. **Las transacciones son la única fuente de verdad.** Posiciones, efectivo y métricas se calculan; no se guardan como estado editable.
2. **El motor de cálculo es puro** (`lib/engine`): recibe transacciones, precios y tipos de cambio, y devuelve resultados. Sin acceso a la base ni a la red, para poder testearlo a fondo.
3. **Los datos de mercado se comparten entre usuarios** (instrumentos, precios): se guardan una sola vez y los actualiza el cron.
4. **Proveedor de datos intercambiable**: toda consulta externa pasa por `MarketDataProvider`.
5. **Caché primero**: la UI solo lee de la base. Si falta un precio, se muestra el último conocido con su fecha.

---

## 5. Modelo de datos (Postgres / Supabase)

### 5.1 Tablas de usuario (con RLS: `user_id = auth.uid()`)

```sql
-- Perfil
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  base_currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create table portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  benchmark_symbol text not null default 'SPY',
  created_at timestamptz not null default now()
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  portfolio_id uuid not null references portfolios on delete cascade,
  name text not null,              -- ej. "IBKR"
  currency text not null default 'USD',
  cost_method text not null default 'AVERAGE' check (cost_method in ('AVERAGE','FIFO')),
  created_at timestamptz not null default now()
);

create type tx_type as enum (
  'BUY','SELL','DIVIDEND','DEPOSIT','WITHDRAWAL','FEE','INTEREST','SPLIT','TAX'
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  account_id uuid not null references accounts on delete cascade,
  type tx_type not null,
  instrument_id uuid references instruments,     -- null para DEPOSIT/WITHDRAWAL/FEE/INTEREST de la cuenta
  executed_at timestamptz not null,
  quantity numeric(20,8),                         -- acciones (fraccionarias permitidas)
  price numeric(20,8),                            -- precio unitario SIN comisión
  amount numeric(20,4),                           -- monto en efectivo (dividendos, depósitos, etc.)
  fee numeric(20,4) not null default 0,
  currency text not null default 'USD',
  split_ratio numeric(20,8),                      -- para SPLIT: nuevas/viejas (ej. 10 para 10:1)
  notes text,
  source text not null default 'manual',          -- 'manual' | 'delta_csv' | 'csv' | 'ibkr_flex'
  import_id uuid,                                 -- la importación de la que salió (para deshacerla); null si es manual
  external_id text,                               -- para deduplicar importaciones
  created_at timestamptz not null default now(),
  unique (account_id, source, external_id)
);

create table watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null default 'Watchlist'
);

create table watchlist_items (
  watchlist_id uuid references watchlists on delete cascade,
  instrument_id uuid references instruments,
  user_id uuid not null references auth.users on delete cascade,
  added_at timestamptz not null default now(),
  primary key (watchlist_id, instrument_id)
);

create table imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  account_id uuid references accounts,
  source text not null,
  filename text,
  rows_total int, rows_imported int, rows_skipped int,
  report jsonb,                                   -- errores y advertencias por fila
  created_at timestamptz not null default now()
);
```

*(**Varios portafolios**, 2026-09-28: cada persona tiene de 1 a 5 portafolios, por ejemplo uno de acciones y otro de cripto, y cada portafolio tiene exactamente una cuenta, que la app no muestra: el libro y el costo promedio siguen siendo por cuenta, así que un mismo símbolo en dos portafolios no se mezcla. Los nombres no tienen espacios en los bordes, son de hasta 40 caracteres y son únicos por persona sin distinguir mayúsculas. `create_portfolio` crea el portafolio con su cuenta; los triggers `portfolios_check_limit` y `portfolios_keep_one` ponen el tope y que no se pueda borrar el último (salvo al borrar a la persona). Migración `multiple_portfolios`.)*

### 5.2 Tablas de mercado (compartidas; lectura para usuarios autenticados, escritura solo con service role)

```sql
create table instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,          -- símbolo canónico, ej. 'VOO', 'BRK-B'
  name text,
  type text,                            -- 'STOCK' | 'ETF' | 'CRYPTO'
  exchange text,
  currency text not null default 'USD',
  sector text, industry text,
  provider_symbol text,                 -- símbolo en el proveedor, si difiere
  history_backfilled_at timestamptz,
  history_from date,                    -- desde qué fecha se pidió el último backfill (Fase 3)
  created_at timestamptz not null default now()
);

create table prices_daily (
  instrument_id uuid references instruments on delete cascade,
  date date not null,
  close numeric(20,6) not null,
  adj_close numeric(20,6),
  primary key (instrument_id, date)
);

create table quotes_latest (
  instrument_id uuid primary key references instruments on delete cascade,
  price numeric(20,6) not null,
  change numeric(20,6), change_pct numeric(10,6),
  as_of timestamptz not null
);

create table corporate_actions (          -- splits y dividendos detectados desde el proveedor
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid references instruments,
  type text not null,                     -- 'SPLIT' | 'DIVIDEND'
  ex_date date not null,
  ratio numeric(20,8), amount numeric(20,6),
  unique (instrument_id, type, ex_date)
);
```

> Fase 3: además existen `market_job_runs` (registro durable de las corridas de los crons; solo la usa el servidor) y la función `active_instruments()` (los instrumentos con transacciones o watchlist de cualquier usuario; solo `service_role`). Ver `docs/decisions.md`.

### 5.3 RLS
- Activar RLS en **todas** las tablas.
- Tablas de usuario: políticas `select/insert/update/delete` con `user_id = auth.uid()`.
- Tablas de mercado: `select` para el rol `authenticated`; sin políticas de escritura. Solo escribe el cron, con la service role key del lado del servidor.
- La service role key **nunca** llega al cliente.
- Crear un test de integración (o un script SQL) que verifique que el usuario A no puede leer datos del usuario B. Como no hay base local, el test corre contra `finance-dev` (usuarios de prueba creados con la service role key y borrados al terminar); nunca contra `finance`.

### 5.4 Migraciones
Supabase CLI (`supabase/migrations/*.sql`). Cada cambio de esquema es una migración versionada. Se aplican con `supabase link` + `supabase db push` al proyecto vinculado (`finance-dev` en desarrollo). No hay base local ni `supabase db reset`; verificar el ref del proyecto vinculado antes de cada push. El proyecto `finance` (producción) solo se toca en la Fase 7 y con confirmación explícita. Las migraciones aplicadas son la fuente de verdad del esquema; sus diferencias con el SQL de la sección 5.1 están en `docs/decisions.md`.

---

## 6. Motor de cálculo (`lib/engine`)

Módulo TypeScript **puro**. Entrada: transacciones de una cuenta o portafolio, precios diarios, cotizaciones recientes y splits. Salida: estructuras tipadas.

### 6.1 Posiciones
Recorrer las transacciones en orden cronológico (con desempate estable por `created_at`):

- **BUY**: `qty += quantity`; `cost_basis += quantity * price + fee`.
- **SELL** (método promedio, default):
  - `avg_cost = cost_basis / qty`
  - `proceeds = quantity * price - fee`
  - `realized += proceeds - quantity * avg_cost`
  - `cost_basis -= quantity * avg_cost`; `qty -= quantity`
- **SELL** (FIFO, opcional por cuenta): consumir lotes en orden y calcular el realizado por lote.
- **SPLIT**: `qty *= ratio`; `cost_basis` no cambia. Los precios históricos anteriores se ajustan al comparar.
- **DIVIDEND**: no cambia la cantidad; suma a `dividends_received` y al efectivo.
- Si `qty` queda en ~0 (tolerancia `1e-9`), la posición se cierra; su realizado se conserva.
- Error de validación si una venta deja la cantidad negativa (short no soportado).

Salida por posición: `symbol, qty, avg_cost, cost_basis, market_value, unrealized_pnl, unrealized_pct, realized_pnl, dividends, day_change, weight`.

### 6.2 Efectivo
Por cuenta: `cash = Σ DEPOSIT − Σ WITHDRAWAL − Σ (BUY qty*price + fee) + Σ (SELL qty*price − fee) + Σ DIVIDEND + Σ INTEREST − Σ FEE − Σ TAX`.
Si el efectivo queda negativo, se muestra una advertencia (probable transacción faltante), sin bloquear.

### 6.3 Valor del portafolio
`total_value = Σ market_value + cash`. El precio de mercado sale de `quotes_latest` si es del día; si no, del último `prices_daily.close`, mostrando la fecha.
*(Regla exacta en `pickPrice`, `lib/engine/valuation.ts`: la cotización si su día es igual o posterior al del último cierre.)*

### 6.4 Serie histórica diaria
Para cada día hábil desde la primera transacción: reconstruir cantidades y efectivo a esa fecha y valuar con `prices_daily`. Para días sin precio (feriados), usar el último cierre conocido. Guardar la serie calculada en memoria o en caché; no es fuente de verdad.
*(Hecho en la Fase 5, `lib/engine/series.ts`: días hábiles en hora de Nueva York; los cierres —ajustados por splits hacia atrás— se multiplican por la razón de los `SPLIT` del libro que todavía no ocurrieron, para que precio y cantidad estén en las mismas unidades; sin ningún cierre previo, la posición se valúa a costo. Se recalcula por pedido, sin caché.)*

*(**Cripto y fines de semana**, 2026-09-28: la grilla sigue siendo de días hábiles, así los retornos diarios de la cripto se comparan con los de las acciones y la volatilidad se anualiza con 252.
- La cripto cotiza todos los días. Si la serie termina un sábado o un domingo (hay una cotización o un cierre de ese día), ese día es el **último punto**, así el gráfico cierra con el valor de Inicio. Una operación de ese fin de semana cuenta ahí.
- Al llegar el lunes, ese punto desaparece y el lunes absorbe el movimiento del fin de semana.
- El punto en vivo sigue siendo todo o nada con el benchmark en días hábiles. Un fin de semana, un benchmark de acciones que no cotiza queda con su último cierre.
- En «Antes de comprar», los retornos también se miran en días hábiles, aunque se comparen dos criptos.)*

*(**Punto en vivo**, `lib/portfolio/live-series.ts`: el cron guarda el cierre una vez por día, al terminar la rueda, así que durante la rueda la serie llegaba hasta ayer mientras el valor de Inicio ya usaba la cotización. Ahora, si una cotización es de un día de rueda posterior al último cierre de su serie, se suma como el último punto (día de Nueva York, sin tocar `lib/engine`: entra como un cierre más). Sirve al gráfico, el TWR, el XIRR, la ganancia del período, el rendimiento por mes, el riesgo, los minigráficos y el gráfico de precio de una posición. Es todo o nada entre el portafolio y el benchmark: si el benchmark no llega en vivo al mismo día, ninguna serie suma punto y queda con cierres. Sin ningún cierre previo tampoco hay punto (un salto de costo a mercado no es rendimiento). Con la cotización del mismo día que el último cierre, gana el cierre; al llegar el cierre del día el punto en vivo desaparece solo. La tarjeta lo rotula («cierres al 24/09 y cotización del 25/09 11:47»).)*

### 6.5 Rendimientos
- **Flujos externos** = `DEPOSIT` (+) y `WITHDRAWAL` (−). Compras, ventas y dividendos son internos.
- **TWR (time-weighted)**, con encadenamiento diario:
  `r_t = V_t / (V_{t−1} + F_t) − 1`, donde `V_t` es el valor al cierre del día t y `F_t` el flujo externo neto del día t (convención: el flujo ocurre al inicio del día, así que forma parte de la base de ese día; documentarla en el código). El primer día `V_{t−1} = 0` y la base es solo el depósito.
  `TWR = Π (1 + r_t) − 1`. Anualizar solo si el período es mayor a 1 año.
- **XIRR (money-weighted)**: flujos externos con signo (desde el punto de vista del inversor), más el valor final como flujo positivo. Resolver con Newton-Raphson y bisección como respaldo.
- **Benchmark**: rendimiento del `benchmark_symbol` (default SPY) en el mismo período, usando `adj_close` para incluir dividendos. Gráfico con ambas series normalizadas a 100.
- Períodos: 1S, 1M, 3M, YTD, 1A, Todo.
*(Hecho en la Fase 5, `lib/engine/{returns,performance}.ts`. El período es `(día base, hoy]`. XIRR con Newton y bisección, en `number` (es una tasa para mostrar), y solo para períodos de 30 días o más. Un período más largo que el historial se recorta a Todo.)*

### 6.6 Asignación
Por instrumento, por tipo (acción/ETF) y por sector si está disponible. El efectivo aparece como categoría propia.
*(Hecho en la Fase 4 por instrumento y por tipo: `lib/engine/allocation.ts`. El sector queda para después: los ETF no lo tienen.)*

### 6.7 Reglas numéricas
- Usar decimal para dinero; redondear solo al mostrar.
- Tolerancia de cantidad `1e-9`; acciones fraccionarias con hasta 8 decimales.
- Todas las fechas en UTC en la base; la UI muestra hora de `America/Montevideo`. Para asignar una transacción a un "día de mercado", usar la hora de Nueva York.

---

## 7. Datos de mercado

### 7.1 Interfaz

```ts
interface MarketDataProvider {
  search(query: string): Promise<InstrumentSearchResult[]>;
  getQuotes(symbols: string[]): Promise<Quote[]>;
  // Barras + splits/dividendos de la MISMA respuesta: dos consultas separadas podrían quedar a
  // ambos lados de un split y dejar precios ajustados con eventos viejos.
  getDailyHistory(symbol: string, from: Date, to: Date): Promise<DailyHistory>;
  getProfile?(symbol: string): Promise<InstrumentProfile>;
  // Ficha de un activo (§10.2): datos de la empresa o del fondo y barras del día. No guardan nada.
  getCompanyData?(symbol: string, kind: "stock" | "etf"): Promise<CompanyData>;
  getIntradaySeries?(symbol: string, range: "1w" | "1m"): Promise<IntradayPoint[]>;
}
```

- Implementación principal: `YahooProvider` (`yahoo-finance2`). No es una API oficial: envolver todo en try/catch, validar con Zod y registrar los fallos.
- Implementación alternativa: `FinnhubProvider` o `TwelveDataProvider`, elegida con la variable de entorno `MARKET_DATA_PROVIDER`.
- Rate limiting simple más reintentos con backoff exponencial.
- Solo `YahooProvider` está implementado (Fase 3); `MARKET_DATA_PROVIDER` valida los otros dos nombres pero responden "no implementado".
- Los montos del proveedor son strings decimales redondeados una sola vez (Yahoo trae ruido de float32, p. ej. `1730.97998046875`).
- **Datos de la empresa** (`getCompanyData`): `quoteSummary` con `summaryDetail` y `defaultKeyStatistics` (acciones y ETFs) y, solo para acciones y en otra consulta, `earningsHistory` y `calendarEvents` (ganancias de los últimos 4 trimestres y próxima fecha de resultados). Un ETF no tiene ganancias: Yahoo responde «No fundamentals data found», que se trata como «no hay» y no se reintenta. Una cripto muestra «Datos de la moneda» (precios, rango, volumen y capitalización, a centavos) y no pide ganancias. Cada campo se valida por su cuenta con Zod y, si falta o cambia de tipo, queda vacío (la fila no se muestra); no se descarta todo por un dato roto. Son informativos: no entran a ningún cálculo ni se guardan.
- **Serie intradía** (`getIntradaySeries`): `chart` con barras de 30 minutos (la semana, las últimas 5 ruedas) o de 1 hora (el mes).
- Lo que devuelven estas dos consultas se cachea en el servidor (`unstable_cache`: 1 hora los datos de la empresa, 5 minutos las barras; los fallos no se cachean). Sin cambios de esquema.

### 7.2 Jobs (crons)
| Job | Frecuencia | Qué hace |
|---|---|---|
| `/api/cron/daily-prices` | 1 vez por día hábil, después del cierre de NY (ej. 22:00 UTC) | Para todos los instrumentos usados en alguna posición o watchlist: guarda el cierre en `prices_daily`, actualiza `quotes_latest` y detecta splits y dividendos nuevos. |
| `/api/cron/backfill` | Cuando se crea un instrumento, o en el mismo cron diario si hay pendientes | Descarga el historial de al menos los últimos 5 años (o desde la primera transacción, si es más vieja) y completa `history_backfilled_at`. *(Hasta el 2026-09-28 los 5 años eran solo de la watchlist; «Antes de comprar» necesita el último año de toda la cartera.)* |

- Proteger los endpoints con el header `Authorization: Bearer ${CRON_SECRET}`.
- Si el plan gratuito de Vercel Cron limita la frecuencia, usar GitHub Actions (`schedule:`) llamando al endpoint.
- El cron diario también evita que Supabase pause el proyecto por inactividad.
- Programado en `vercel.json` (`0 22 * * 1-5`, un solo horario: el máximo de Hobby). `/api/cron/backfill` existe pero no se programa: el diario ya descarga lo pendiente.
- Yahoo devuelve `close` nulo algunos días hábiles y reajusta hacia atrás el historial en cada split (`close`) y dividendo (`adj_close`): el job descarta las barras nulas, detecta el reajuste y vuelve a bajar el historial completo del instrumento.
- Botón "Actualizar ahora" en la UI: refresca `quotes_latest` solo de las posiciones del usuario, con un límite de 1 vez cada 5 minutos por usuario. *(También de los símbolos que sigue y del benchmark —`SPY`—: el gráfico de rendimiento compara contra él y necesita su cotización de hoy para cerrar el mismo día que el portafolio, §6.4. El benchmark agregado por nosotros no cuenta en el mensaje de resultado.)*

---

## 8. Importación de CSV (formato simple y Delta)

### 8.1 Formato de entrada (export de Delta)
Columnas:
`Date, Way, Base amount, Base currency (name), Base type, Quote amount, Quote currency, Exchange, Sent/Received from, Sent to, Fee amount, Fee currency (name), Broker, Notes, Sync Base Holding, Leverage Metadata`

Ejemplos:
```
"2026-03-06T22:30:00.000Z","DEPOSIT",4200,"USD (United States dollar)","FIAT",,,,"OTHER","MY_WALLET",,,"","Comision 30USD",false,
"2026-03-09T22:34:00.000Z","BUY",3,"VOO (Vanguard S&P 500 ETF)","FUND",1725.72,"USD","New York Stock Exchange",,,1,"USD",,,true,
"2026-03-09T22:34:00.000Z","WITHDRAW",1726.72,"USD (United States dollar)","FIAT",,,"New York Stock Exchange","MY_WALLET","OTHER",,,,"SYNC-BASE-HOLDINGS_BUY_VOO/USD",false,
"2026-04-06T22:42:00.000Z","SELL",37,"KOS (Kosmos Energy Ltd)","STOCK",117.105,"USD","New York Stock Exchange",,,1,"USD",,,true,
```

### 8.2 Reglas de mapeo
| Fila Delta | Transacción resultante |
|---|---|
| `Way=BUY` | `BUY`, `quantity = Base amount`, **`price = Quote amount / Base amount`** (Quote amount es el TOTAL, no el unitario), `fee = Fee amount \|\| 0`. |
| `Way=SELL` | `SELL`, mismo cálculo de precio y comisión. |
| `Way=DEPOSIT` / `WITHDRAW` con `Notes` que empieza con `SYNC-BASE-HOLDINGS_` | **Ignorar.** Son las patas de efectivo automáticas de Delta; el motor ya calcula el efectivo a partir de BUY/SELL. |
| `Way=DEPOSIT` sin esa nota y con `Base type=FIAT` | `DEPOSIT` (flujo externo), `amount = Base amount`. |
| `Way=WITHDRAW` sin esa nota y con `Base type=FIAT` | `WITHDRAWAL` (flujo externo). |
| Otros `Way` (dividendos u otros, si aparecen) | Mapear si es posible; si no, reportar la fila como no soportada. |

- **Símbolo**: tomar el texto de `Base currency (name)` antes del primer espacio (`"VOO (Vanguard S&P 500 ETF)"` → `VOO`). Tipo: `FUND` → ETF, `STOCK` → STOCK.
- **Fecha**: ISO en UTC, tal cual.
- **Deduplicación**: `external_id = hash(Date + Way + símbolo + Base amount + Quote amount)`.
- **Flujo de importación**: subir archivo → parseo y validación con Zod → **pantalla de vista previa** (transacciones a crear, filas ignoradas con motivo, errores) → confirmar → insertar en una sola transacción de base de datos (función SQL `import_transactions`) → guardar el reporte en `imports`. La confirmación vuelve a parsear el archivo desde cero; las filas con error del archivo bloquean la confirmación.
- Crear en `instruments` los símbolos que no existan y encolar su backfill.

### 8.3 Fixture y resultados esperados (test de aceptación)
Guardar un export de Delta como `lib/engine/__fixtures__/delta_export.csv`. Con método de costo promedio y comisiones incluidas en el costo, el motor debe dar:

**Posiciones abiertas (antes de la compra de DDOG):**
| Símbolo | Cantidad | Costo base (USD) |
|---|---|---|
| VOO | 8.95 | 5724.77 |
| SOXX | 4 | 2069.50 |
| FSLY | 30 | 346.80 |
| ILF | 12 | 331.60 |
| NFLX | 2 | 191.60 |
| **Total** | | **8664.27** |

**Posiciones cerradas — ganancia realizada:**
| Símbolo | Realizado (USD) |
|---|---|
| MELI | 180.55 |
| URTH | 42.70 |
| KOS | 11.135 |
| QCOM | 7.52 |
| TTWO | 5.11 |
| **Total** | **247.015** |

**Efectivo:** depósitos externos 9300.00 − compras con comisión 11696.66 + ventas netas de comisión 3279.405 = **882.745 USD**.

**Transacción manual para probar después de importar:** `BUY DDOG 2 @ 251.41, fee 1.00, 2026-09-23` → costo base de DDOG 503.82 y efectivo 378.925.

> Nota: el efectivo que muestra Delta puede diferir del cálculo cuando Delta registró dividendos que no aparecen en el CSV exportado. No es un bug del motor: se corrige cargando los dividendos (manualmente o vía IBKR Flex).

### 8.4 Formato simple («Portfolio Tracker») y pantalla de importación
Casi ningún usuario usa Delta, así que el formato principal es uno propio, simple y documentado en la pantalla (`lib/importers/simple.ts`, `docs/importar-csv.md`). **Es el mismo que escribe «Exportar CSV»**: exportar → importar es ida y vuelta (backup, restauración y mudanza de una base a otra). Un archivo se reconoce solo por sus encabezados (`lib/importers/detect.ts`): `Way` + `Base amount` → Delta (sin cambios); `fecha` + `tipo` → simple.

| Operación | Columnas |
|---|---|
| Compra / Venta | `fecha, tipo, simbolo, cantidad, precio` (precio **por unidad**) y `comision` opcional |
| Depósito / Retiro / Comisión / Impuesto | `fecha, tipo, monto` |
| Interés | `fecha, tipo, monto` (puede ser negativo) |
| Dividendo | `fecha, tipo, simbolo, monto` |
| Split | `fecha, tipo, simbolo, razon_split` (10 = 10:1; 0,1 = inverso 1:10) |

- **Encabezados** tolerantes (minúsculas, sin tildes, alias en español e inglés; `fecha_utc` gana sobre `fecha` y `fecha_montevideo`); las columnas de más se ignoran. **Tipos** en inglés (`BUY`…, como el export) o español (`compra`, `venta`, `depósito`, `retiro`, `dividendo`, `split`, `comisión`, `impuesto`, `interés`).
- **Fechas:** `AAAA-MM-DD`, `AAAA-MM-DD HH:mm[:ss]`, ISO con zona y `DD/MM/AAAA [HH:mm]` (**día antes que mes**). Sin zona = hora de Montevideo; sin hora = mediodía de Montevideo (mismo día en Nueva York; los empates conservan el orden del archivo). Se rechazan las que no existen (31/02), las futuras y las de antes de 1990.
- **Números:** punto o coma decimal (uno solo, sin separador de miles), con los mismos límites de dígitos que el formulario manual. **Delimitador** `,` `;` o tabulación, autodetectado (el Excel en español guarda con `;`); BOM y CRLF ok. Solo USD.
- **Deduplicación:** `external_id = csv:` + instante + tipo + símbolo + cantidades + comisión (las filas idénticas del mismo archivo llevan sufijo `#2`, `#3`…), con `source = 'csv'`.
- **Símbolos nuevos** (escrito a mano: un error de tipeo es probable): se verifican con el proveedor (`resolveNewInstrument`) hasta 40 por archivo; uno que no existe es un error de esa fila y bloquea; si el proveedor no responde también bloquea (sin él no se sabe si es acción o ETF). Los instrumentos salen con el nombre y el tipo del proveedor. Delta no se verifica.
- **Parecidas a lo ya cargado:** lo cargado a mano y lo importado no comparten identificador; una fila con el mismo día (Montevideo), tipo, símbolo y cantidad (o monto) que algo ya cargado —de cualquier origen— se **excluye por defecto**, se lista aparte y se importa solo si la persona tilda «Importar igual». Cuenta repeticiones.
- **Plantilla** descargable (`/activity/import/plantilla`) con filas de ejemplo; subirla sin tocar, o dejar los ejemplos mezclados, es un error.
- **Entrada:** archivo `.csv` o **filas pegadas** desde una planilla (llegan con tabulaciones). Hasta 1 MB y 5000 operaciones.
- **Vista previa:** formato detectado, las operaciones interpretadas (fecha día/mes/año, tipo, símbolo, cantidad y precio) para verificar a ojo, errores agrupados por causa, las parecidas, y cómo quedaría el portafolio.
- **Deshacer una importación:** cada transacción importada guarda su `import_id`; `undo_import` borra las de esa importación y la marca (`imports.undone_at`), pero antes el servidor valida con `validateLedgerChange` (`removeMany`) que el libro siga consistente (no puede quedar una venta sin su compra). Las importaciones anteriores a esta función no se pueden deshacer.

---

## 9. Importación desde IBKR Flex Query (fase posterior)

- IBKR permite definir una Flex Query (Trades, Cash Transactions, Corporate Actions) y consultarla por el Flex Web Service con un token de solo lectura.
- Guardar el token **cifrado** (por ejemplo con `pgsodium` o cifrado de aplicación con una clave en variable de entorno) y solo del lado del servidor.
- Mapear: trades → BUY/SELL (con comisión), dividendos → DIVIDEND, retenciones → TAX, depósitos y retiros → DEPOSIT/WITHDRAWAL, splits → SPLIT.
- Deduplicar por el ID de transacción de IBKR (`external_id`).
- Opción de sincronización diaria dentro del cron.
- Verificar la documentación vigente de IBKR antes de implementar.

---

## 10. Funcionalidades y pantallas

Mobile-first, pensado para un ancho de 390px. Navegación inferior tipo app con: **Inicio, Posiciones, Watchlist, Actividad y Más**.

**Varios portafolios** (2026-09-28): con más de uno, Inicio, Posiciones y Actividad muestran arriba del título un selector (un `<select>` nativo) con el portafolio que se está mirando. La elección se guarda en la cookie `pt-portfolio` (HttpOnly), que el servidor cruza siempre con los portafolios de la persona: si ya no existe o es ajena, se mira el primero. La ficha de un activo muestra el nombre del portafolio sin selector, e Inicio, Posiciones, Actividad, la exportación y «Antes de comprar» son del portafolio elegido. La Watchlist es una sola para todos. «Actualizar precios» actualiza las posiciones de todos los portafolios. Con un solo portafolio la app se ve como antes.

**«Todo junto»** (etapa 2, 2026-09-28): con más de un portafolio, la primera opción del selector es «Todos los portafolios» (valor `all` en la cookie).
- **Cálculo:** el libro sigue siendo por cuenta. El motor corre para cada portafolio y después se suman los resultados:
  - `combineEngineResults` suma por símbolo las cantidades, el costo base, lo realizado y los dividendos; el costo promedio sale de la suma.
  - `combineSeries` suma día por día el valor, el efectivo y los flujos, y recalcula el crecimiento diario sobre los totales. El TWR y el XIRR son los de la cartera entera, no un promedio.
  - Mezclar las operaciones de las cuentas estaría mal: aplicaría dos veces un `SPLIT` cargado en cada una y costearía las ventas con el promedio de todas.
- **Benchmark:** el que comparten los portafolios, o SPY si no comparten uno.
- **Pantallas:**
  - Inicio, Posiciones, la ficha y «Antes de comprar» miran la suma.
  - Actividad lista las operaciones de todos, cada una con su portafolio.
  - «Exportar CSV» baja todo en un archivo con una columna `portafolio` al final; el formato simple la ignora al importar.
  - El alta y la importación no arrancan en ningún portafolio: hay que elegirlo.
  - Si un portafolio tiene efectivo negativo, Inicio lo nombra aunque la suma dé positiva.

**Cripto** (etapa 3, 2026-09-28): monedas grandes cotizadas en USD, cargadas a mano o con el formato simple.
- **Símbolo:** el par de Yahoo, `BTC-USD`. No se usa `BTC`, que es el ticker de un ETF de Grayscale y compartirían precios.
- **Tipo:** `instruments.type = 'CRYPTO'`.
- **Yahoo:** la búsqueda ofrece `CRYPTOCURRENCY` solo en pares `-USD` de la bolsa `CCC`; quedan afuera los futuros (`BTC=F`) y los pares en otra moneda (`BTC-EUR`). Las barras diarias vienen en días UTC, también los fines de semana, y la del día UTC en curso no se guarda: su «rueda» es el día entero.
- **Pantallas:**
  - Se rotula «Cripto» en Posiciones, la ficha, el buscador, la Watchlist y la composición por tipo.
  - La ficha muestra «Datos de la moneda» y no muestra ganancias.
  - «Antes de comprar» agrupa las cripto como «Cripto».
- **Benchmark:** cada portafolio elige contra qué compararse, S&P 500 o Bitcoin. «Todo junto» usa el que comparten o, si no comparten uno, SPY.
- **Importar:** de Delta sigue sin importarse cripto; por eso el mensaje de tipo no soportado dice cómo cargarla.

### 10.1 Inicio (dashboard)
- Valor total, cambio del día ($ y %), **ganancia total y aportado neto** (valor − depósitos + retiros, con su % sobre lo aportado), ganancia no realizada y realizada.
- Gráfico con selector de período y tres modos: **ganancia acumulada en US$** (por defecto: valor − aportes netos, sin saltos por depósitos), valor, y comparación contra el benchmark (TWR del portafolio vs. SPY, normalizados a 100).
- Tarjetas: TWR, XIRR, efectivo disponible, dividendos del año.
- **Ganancia por posición**: barras divergentes por símbolo, abiertas y cerradas (Total u Hoy), que reemplazan a los top ganadores y perdedores del día.
- Composición (por posición o por tipo) y **tus posiciones** más grandes con un minigráfico del último mes.
- **Rendimiento por mes** (portafolio vs. benchmark) y **riesgo** (caída máxima, volatilidad, mejor y peor día y gráfico de caídas; plegado).
*(Hecho en el Inicio v2 después de la Fase 6; ver `docs/decisions.md`.)*

### 10.2 Posiciones
- Lista ordenable por valor, % del día, ganancia $ o ganancia %.
- Toggle para mostrar posiciones cerradas.
- Detalle por posición: gráfico de precio con marcadores de compra y venta, cantidad, costo promedio, costo base, valor, ganancia no realizada y realizada, dividendos, peso en el portafolio e historial de transacciones.
- **Ficha de un activo** (posición o símbolo que se sigue): la tarjeta «Evolución del precio» con **rango variable 1S / 1M / 1A** (1A con los cierres diarios guardados y la cotización de hoy al final; 1S y 1M con barras del día de Yahoo, que se piden al tocarlas y se recuerdan en la pantalla; si Yahoo falla caen a los cierres diarios con un aviso), el cambio del período con signo y flecha, y el **rango de 52 semanas superpuesto**: líneas punteadas del máximo y el mínimo con su valor (en 1A siempre; en 1S y 1M solo si caen dentro de la escala del período) y, debajo, la barra de rango con el precio marcado. El rango de 52 semanas es el del proveedor (incluye los extremos dentro del día); si no viene, el de los cierres guardados.
- **Datos de la empresa** (o «del fondo» en un ETF): cierre anterior, apertura, rango del día y de 52 semanas, volumen y volumen promedio (3 meses), capitalización, P/E (12 meses y próximos 12), BPA, dividendo anual y rentabilidad, acciones en circulación y flotantes, P/B, valor contable, precio/ventas y beta; para un ETF, además, patrimonio total, valor de la cuota (NAV), categoría y retorno del año. Las cantidades grandes se escriben con palabras («4,21 billones», «12,23 mil millones»: escala larga del español). Cada dato que falta es una fila que no se muestra.
- **Ganancias** (solo acciones): el BPA real de los últimos 4 trimestres contra el consenso de los analistas, con el veredicto en texto (**Superó / En línea / No llegó**, «por US$ 0,61») y la próxima fecha de resultados. El trimestre se rotula por el calendario en el que cierra el período («T3 2025»).
- **Antes de comprar** (posición o símbolo que se sigue; no es una recomendación de compra, y la tarjeta lo dice): un monto a elegir entre cuatro (el primero es el **aporte típico**: la mediana de lo depositado por mes en los últimos 12; sin depósitos, US$ 1.000) y dos partes:
  - **Qué le hace a tu cartera**, comprándolo con plata nueva: el peso del símbolo, el de su sector (los ETF son un grupo aparte: no traen sector), las 3 posiciones más grandes y la volatilidad a 1 año, antes y después; y el **parecido** (correlación de los retornos diarios del último año con el resto de la cartera, con una frase: «se mueve casi igual» ≥ 0,8, «se parece bastante» ≥ 0,5, «se mueve bastante distinto» ≥ 0, «tiende a moverse al revés») y la posición que más se le parece. Es la cartera de hoy con los movimientos del último año (pesos fijos, el efectivo rinde 0). Una posición con historia que arranca más de una semana tarde queda afuera con un aviso; si es el propio símbolo el que tiene poca historia, la ventana se acorta y se avisa; con menos de 60 ruedas en común no hay parecido ni volatilidad.
  - **¿Lo habrías aguantado?**: el monto invertido el primer día hábil de cada mes a 1, 3 o 5 años (12, 36 o 60 aportes; «Todo» si el símbolo salió a bolsa hace menos), con fracciones y los dividendos reinvertidos (`adj_close`): lo aportado, lo que valdría hoy, lo mismo en el benchmark, el **peor momento** (la mayor pérdida sobre lo aportado y cuándo volvió) con la pregunta «¿Habrías seguido comprando?» si pasó del 10 %, y la mayor caída del precio. Gráfico de lo aportado, el valor y el benchmark.
  - Todo sale de `prices_daily` (sin llamadas a Yahoo); el cálculo es del motor puro (`lib/engine/what-if.ts`).

### 10.3 Actividad (transacciones)
- Lista con filtros (tipo, símbolo, fecha) y alta, edición y eliminación.
- Formulario con autocompletado de símbolo (`search` del proveedor), cantidad, precio, comisión y fecha.
- En el alta de una compra o venta, al elegir el símbolo se trae la **cotización actual** (`getReferencePrice`, una consulta al proveedor que no guarda nada) y se deja escrita en el precio, como la fecha y la hora que arrancan en «ahora». Debajo del precio dice de cuándo es (si es del cierre, se ve la hora del cierre). Es editable: si la persona ya escribió un precio no se le pisa y queda el botón «Usar este precio». No aplica a la edición de una operación ni a los tipos sin precio por acción.
- Importar CSV (Delta y, más adelante, un formato genérico) y exportar todo a CSV como backup.
- Con varios portafolios: el alta pregunta en cuál guardar y arranca en el que se está mirando. La edición y el borrado se hacen en el portafolio de la operación, porque una operación no se mueve de portafolio. La importación pregunta a cuál importar, y «Deshacer» valida el libro del portafolio de esa importación. «Exportar CSV» baja el portafolio elegido, con su nombre en el nombre del archivo; el formato del CSV no cambia.

### 10.4 Watchlist
- Agregar y quitar símbolos (hasta 50, en orden alfabético); ver precio, cambio del día, rango de 52 semanas y un minigráfico. El rango son los **cierres diarios** de las últimas 52 semanas (`prices_daily` no guarda máximos y mínimos intradiarios) y el precio actual se suma al rango.
- Tocar un símbolo abre el mismo detalle que una posición; si no hay posición, se muestra precio, la evolución del precio con rango (1S/1M/1A) y el rango de 52 semanas, «Antes de comprar» (§10.2), los datos de la empresa, las ganancias y el botón de seguir o dejar de seguir, sin costos ni operaciones.

### 10.5 Más
- Cuentas y portafolios (crear, renombrar, método de costo), benchmark, moneda, exportar datos, cerrar sesión.
*(Hecho, 2026-09-28: «Portafolios» (`/more/portfolios`) permite crear uno nuevo, y al crearlo pasa a ser el que se mira. Cada portafolio se puede renombrar o borrar; para borrar hay que escribir su nombre, avisa cuántas operaciones se van con él y no se puede borrar el último. Las cuentas no se muestran. Etapa 3: el benchmark se elige al crear el portafolio y en sus ajustes, con «Comparar con» S&P 500 (SPY) o Bitcoin (BTC-USD).)*

### 10.6 PWA
- `manifest.webmanifest` con `display: standalone`, íconos (incluido `apple-touch-icon` de 180×180), `theme_color` y soporte para modo claro y oscuro.
- Respetar `env(safe-area-inset-*)` para el notch y la barra inferior del iPhone.
- Service worker mínimo (`public/sw.js`): precachea solo la pantalla sin conexión y sus archivos, y la muestra cuando una navegación falla por falta de red. **No guarda páginas ni datos financieros.** La pantalla sin conexión muestra el último estado conocido de Inicio, que la app deja en el `localStorage` del dispositivo (textos ya formateados; vence a los 30 días y se borra al llegar a `/login`).
- El modo oscuro sigue al sistema (`prefers-color-scheme`), sin interruptor manual.

---

## 11. Seguridad y privacidad

- RLS en todas las tablas (sección 5.3), con un test que lo verifique.
- La service role key y `CRON_SECRET` solo en variables de entorno del servidor.
- Validar todos los inputs con Zod en server actions y route handlers.
- Login con **código de 6 dígitos** enviado por email (SMTP propio; no hay enlace), con un límite de intentos de verificación por email; registro solo por **invitación** (lista de emails permitidos en la tabla `public.allowed_emails`, que consulta el hook "Before User Created" de Supabase Auth), para que la app no quede abierta a cualquiera. Habilitar a alguien es insertar su email en esa tabla.
- Sin analytics de terceros.
- Exportación completa de datos del usuario (CSV o JSON) y opción de borrar la cuenta.

---

## 12. Estructura del repo

```
/
├─ app/
│  ├─ (auth)/login/
│  ├─ (app)/            # layout con navegación inferior
│  │  ├─ page.tsx       # Inicio
│  │  ├─ positions/ [symbol]/
│  │  ├─ activity/ import/
│  │  ├─ watchlist/
│  │  └─ settings/
│  └─ api/cron/{daily-prices,backfill}/route.ts
├─ lib/
│  ├─ engine/           # motor puro + tests + __fixtures__
│  │  ├─ positions.ts cash.ts valuation.ts returns.ts allocation.ts
│  │  └─ __tests__/
│  ├─ market-data/      # interfaz + providers (yahoo, finnhub)
│  ├─ importers/        # delta.ts, ibkr-flex.ts (+ tests)
│  ├─ db/               # clientes Supabase, queries tipadas
│  └─ validation/       # schemas Zod
├─ components/          # UI (shadcn + propios)
├─ supabase/migrations/
├─ public/              # manifest, íconos
├─ docs/                # limits.md, decisiones de arquitectura
├─ CLAUDE.md
└─ PROJECT_SPEC.md
```

---

## 13. Variables de entorno

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # clave publicable (sb_publishable_…)
SUPABASE_SECRET_KEY=              # clave secreta (sb_secret_…), solo servidor
CRON_SECRET=
MARKET_DATA_PROVIDER=yahoo        # yahoo | finnhub | twelvedata
FINNHUB_API_KEY=                  # opcional
APP_TIMEZONE=America/Montevideo
```

Incluir `.env.example` en el repo y nunca commitear `.env.local`. `.env.local` apunta al proyecto `finance-dev`; las credenciales de `finance` (producción) viven solo en las variables de entorno de Vercel. La lista de emails con acceso ya no es una variable: vive en la tabla `allowed_emails`.

---

## 14. Cómo trabajar con Claude Code

### 14.1 `CLAUDE.md` sugerido (raíz del repo)
```md
# Contexto
Portfolio tracker personal. La especificación completa está en PROJECT_SPEC.md: leerla antes de cualquier tarea grande.

# Reglas
- TypeScript strict. Nada de `any` sin justificar.
- lib/engine es PURO: sin imports de Supabase, fetch ni Date.now() implícito (recibir la fecha "hoy" como parámetro).
- Dinero con decimal.js; nunca aritmética de floats para montos persistidos.
- Todo cambio de esquema = nueva migración en supabase/migrations.
- Todo cálculo nuevo del motor lleva tests en Vitest, incluidos casos borde.
- Validar inputs con Zod en el servidor.
- No exponer SUPABASE_SECRET_KEY al cliente.
- Supabase solo en la nube (sin Docker ni stack local): `finance-dev` para desarrollo y `finance` para producción. No hacer link/push a `finance` sin pedido explícito.

# Comandos
pnpm dev | pnpm test | pnpm lint | pnpm typecheck | supabase db push (solo dev)
```

### 14.2 Fases (una sesión o PR de Claude Code por fase)

**Fase 0 — Setup**
Next.js + TypeScript + Tailwind + shadcn, `pnpm dlx supabase init` (sin Docker; el proyecto en la nube se vincula en la Fase 2), Vitest, ESLint y Prettier, `.env.example`, CI básica en GitHub Actions (lint, typecheck, test).
✅ `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` pasan, y `supabase/` está inicializado.

**Fase 1 — Motor de cálculo (sin UI)**
`lib/engine` completo para posiciones, efectivo y realizado, con el importador de Delta como función pura.
✅ El test de aceptación de la sección 8.3 pasa con los números exactos.

**Fase 2 — Base de datos + auth**
Vincular `finance-dev` (`supabase link`), migraciones de la sección 5 aplicadas con `supabase db push`, RLS, magic link, lista de emails permitidos y el test de aislamiento entre usuarios.
✅ El usuario A no puede leer datos del usuario B.

**Fase 3 — Datos de mercado + crons**
`MarketDataProvider` con implementación Yahoo, endpoints de cron y backfill.
✅ Después de correr el cron, `prices_daily` tiene historial de todos los símbolos del fixture. *(Hecha: `pnpm test:live`.)*

**Fase 4 — UI principal**
Inicio, Posiciones, detalle de posición, Actividad (con alta manual) e Importar CSV con vista previa.
✅ Importar el CSV de Delta y ver los números de la sección 8.3 en pantalla. *(Hecha: `lib/portfolio/__tests__/app-http.live.test.ts`.)*

**Fase 5 — Métricas avanzadas**
Serie histórica, TWR, XIRR, comparación con benchmark y asignación. *(La asignación por instrumento y por tipo ya está desde la Fase 4.)*
✅ Tests de TWR y XIRR con casos calculados a mano (incluido un depósito a mitad de período). *(Hecha: `lib/engine/__tests__/performance.test.ts`; tarjeta "Rendimiento" en Inicio.)*

**Fase 6 — Watchlist + PWA**
**Requisito previo (hecho):** el ingreso es por **código OTP de 6 dígitos** que se tipea en la app, con **SMTP propio** (Gmail dedicado con contraseña de aplicación). El enlace del correo abría Safari, no la PWA instalada; y el correo por defecto de Supabase (2 mensajes por hora, solo a miembros de la organización) tampoco servía para invitar a un amigo. Detalle en `docs/decisions.md`. Incluye un **deploy temprano a Vercel apuntando a `finance-dev`** (el iPhone exige HTTPS para instalar la app); la producción sigue siendo la Fase 7.
✅ Instalable en el iPhone; se abre sin barra del navegador y se ingresa con el código.

**Fase 7 — Deploy**
Vercel + Supabase en la nube: crear el proyecto `finance` (producción), `supabase link` + `db push` con confirmación explícita y cargar sus credenciales solo en Vercel; crons configurados y dominio opcional.
✅ Funciona en producción con tu cuenta y la de un amigo.

**Fase 8 (opcional) — IBKR Flex Query, dividendos automáticos, FIFO y notificaciones.**

### 14.3 Primer prompt sugerido para Claude Code
> Leé PROJECT_SPEC.md completo. Empezamos por la Fase 0 y la Fase 1. Antes de escribir código, proponé el plan de archivos para `lib/engine` y los tipos principales (Transaction, Position, EngineResult). Después implementá el importador de Delta y el cálculo de posiciones, efectivo y realizado, con tests en Vitest usando el fixture de la sección 8.3 (te paso el CSV). No avances a la UI hasta que el test de aceptación pase.

---

## 15. Decisiones abiertas

- ¿Guardar la serie histórica calculada en una tabla de caché (por ejemplo `portfolio_snapshots`) o recalcularla en cada request? Empezar recalculando; cachear si se vuelve lento.
- ¿Costo promedio o FIFO por defecto? Empezar con costo promedio (el que usan Delta y My Pocket Portfolio, lo que facilita comparar) y dejar FIFO como opción.
- ¿Multimoneda real? El modelo lo soporta (`currency` en cuentas y transacciones), pero la v1 asume USD. Agregar una tabla `fx_rates` si hace falta.
- Proveedor de datos definitivo si Yahoo deja de funcionar.
- Notificaciones push en la PWA de iOS (soportadas en versiones recientes de iOS): opcional, para después.

---

## 16. Definición de "terminado" para la v1

- [ ] Importo el CSV de Delta y veo exactamente las posiciones, el costo base, el realizado y el efectivo de la sección 8.3.
- [ ] Cargo una compra nueva a mano y todo se recalcula (posición, efectivo, porcentajes).
- [ ] Veo el valor total, la ganancia no realizada y realizada, TWR vs. SPY y XIRR.
- [ ] Tengo una watchlist funcional.
- [ ] Está instalada en mi iPhone como app y carga rápido.
- [ ] Un amigo puede usarla con su propia cuenta sin ver mis datos.
- [ ] Costo mensual: USD 0.
