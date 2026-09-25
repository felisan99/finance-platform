import { d, marketDay } from "@/lib/engine";
import type { CompanyData } from "@/lib/market-data";
import { formatDateKey, formatMoney } from "./format";

// Tarjeta «Ganancias»: el BPA real de los últimos trimestres contra el consenso de los analistas.
// Puro. Las barras se dibujan con porcentajes ya calculados (`top`, `height`, `estimateY`) para que
// el componente no haga cuentas; los números salen del decimal a `number` solo para dibujar.

export type Verdict = "beat" | "inline" | "miss";

export const VERDICT_TEXT: Record<Verdict, string> = {
  beat: "Superó",
  inline: "En línea",
  miss: "No llegó",
};

export interface EarningsBar {
  /** `T3 2025`: el trimestre calendario en el que cierra el período. */
  label: string;
  /** Texto para lectores de pantalla: todo lo que dice la barra. */
  summary: string;
  actualText: string;
  estimateText: string | null;
  verdict: Verdict | null;
  verdictText: string | null;
  /** `por US$ 0,61`; `null` si no hay veredicto o quedó en línea. */
  diffText: string | null;
  /** Geometría en % del alto del gráfico, medida desde arriba. */
  top: number;
  height: number;
  estimateY: number | null;
  /** El BPA real es negativo (pérdida): la barra cuelga de la línea del cero. */
  negative: boolean;
}

export interface EarningsView {
  bars: EarningsBar[];
  /** Posición de la línea del cero, en % desde arriba. */
  zeroY: number;
  /** `Próximos resultados: 28/10/2026`; `null` si no hay fecha futura. */
  nextText: string | null;
}

// Una diferencia que se muestra como US$ 0,00 es «en línea»: ni superó ni quedó corto.
const INLINE_BELOW = "0.005";
// Una barra con valor no puede desaparecer por chica que sea frente a las demás.
const MIN_BAR = 1.5;

function quarterLabel(periodEnd: string): string {
  const month = Number(periodEnd.slice(5, 7));
  return `T${Math.ceil(month / 3)} ${periodEnd.slice(0, 4)}`;
}

/** `null` si no hay nada que mostrar: un ETF, o una acción sin trimestres publicados. */
export function buildEarningsView(
  data: CompanyData,
  now: Date,
): EarningsView | null {
  if (data.kind !== "stock" || data.earnings.length === 0) return null;

  const quarters = data.earnings.flatMap((q) => {
    if (q.epsActual === null) return [];
    const actual = d(q.epsActual);
    const estimate = q.epsEstimate === null ? null : d(q.epsEstimate);
    return [{ q, actual, estimate }];
  });
  if (quarters.length === 0) return null;

  const values = quarters.flatMap(({ actual, estimate }) =>
    estimate === null
      ? [actual.toNumber()]
      : [actual.toNumber(), estimate.toNumber()],
  );
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const y = (value: number) => ((max - value) / span) * 100;
  const zeroY = y(0);

  const bars = quarters.map(({ q, actual, estimate }): EarningsBar => {
    const diff = estimate === null ? null : actual.minus(estimate);
    const verdict: Verdict | null =
      diff === null
        ? null
        : diff.abs().lt(INLINE_BELOW)
          ? "inline"
          : diff.gt(0)
            ? "beat"
            : "miss";
    const actualY = y(actual.toNumber());
    const height = Math.max(
      Math.abs(actualY - zeroY),
      actual.isZero() ? 0 : MIN_BAR,
    );
    const top = actualY < zeroY ? zeroY - height : zeroY;
    const label = quarterLabel(q.periodEnd);
    const actualText = formatMoney(actual);
    const estimateText = estimate === null ? null : formatMoney(estimate);
    const diffText =
      diff === null || verdict === "inline" ? null : formatMoney(diff.abs());
    return {
      label,
      summary: [
        `${label}: BPA ${actualText}`,
        estimateText === null ? null : `consenso ${estimateText}`,
        verdict === null ? null : VERDICT_TEXT[verdict].toLowerCase(),
        diffText === null ? null : `por ${diffText}`,
      ]
        .filter((part) => part !== null)
        .join(", "),
      actualText,
      estimateText,
      verdict,
      verdictText: verdict === null ? null : VERDICT_TEXT[verdict],
      diffText: diffText === null ? null : `por ${diffText}`,
      top,
      height,
      estimateY: estimate === null ? null : y(estimate.toNumber()),
      negative: actual.lt(0),
    };
  });

  const today = marketDay(now);
  const nextText =
    data.nextEarningsDate !== null && data.nextEarningsDate > today
      ? `Próximos resultados: ${formatDateKey(data.nextEarningsDate)}`
      : null;
  return { bars, zeroY, nextText };
}
