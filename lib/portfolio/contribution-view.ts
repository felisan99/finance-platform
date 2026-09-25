import {
  ZERO,
  type Dec,
  type EngineTotals,
  type ValuedPortfolio,
} from "@/lib/engine";
import { formatMoney } from "./format";
import { toneOf, type Tone } from "./tone";

// "Ganancia por posición" de Inicio: cuánto aportó cada símbolo al resultado, en dinero. El cálculo
// sale de lo que el motor ya tiene por posición; acá se ordena, se recorta y se formatea (es-UY).
// El componente de cliente solo cambia entre "Total" y "Hoy": recibe textos y proporciones.

/** Posiciones con nombre propio (las de mayor peso, ganando o perdiendo); el resto se agrupa en "Otras". */
export const MAX_NAMED_ROWS = 8;

export interface ContributionRowView {
  key: string;
  label: string;
  /** Detalle de la posición, o `null` si la fila no es un símbolo. */
  href: string | null;
  /** Dinero con signo: `+US$ 412,00`. */
  text: string;
  tone: Tone | null;
  /** Valor sobre el mayor valor absoluto de la lista: −1 a 1, para el largo de la barra. */
  ratio: number;
  /** La posición ya está cerrada (solo cuenta lo realizado). */
  closed: boolean;
}

export interface ContributionModeView {
  rows: ContributionRowView[];
  /** La suma de las filas. En "Total", si todo tiene precio, es la ganancia total del portafolio. */
  totalText: string;
  totalTone: Tone | null;
  /** Aclaración (posiciones que no entran por falta de precio), o `null`. */
  note: string | null;
}

export interface ContributionView {
  total: ContributionModeView;
  day: ContributionModeView;
}

interface Entry {
  key: string;
  label: string;
  href: string | null;
  amount: Dec;
  closed: boolean;
}

const bySymbol = (a: Entry, b: Entry) =>
  a.label < b.label ? -1 : a.label > b.label ? 1 : 0;

/** De la que más ganó a la que más perdió; los empates, por símbolo (sin `localeCompare`). */
const byAmountDesc = (a: Entry, b: Entry) =>
  b.amount.cmp(a.amount) || bySymbol(a, b);

function sum(entries: readonly Entry[]): Dec {
  return entries.reduce((total, entry) => total.plus(entry.amount), ZERO);
}

function toModeView(
  named: readonly Entry[],
  extras: readonly Entry[],
  note: string | null,
): ContributionModeView {
  // Se quedan con nombre las que más pesan en el resultado, para ganar o para perder (una pérdida
  // grande no puede esconderse en "Otras"), y se muestran de la que más ganó a la que más perdió.
  const byMagnitude = [...named].sort(
    (a, b) => b.amount.abs().cmp(a.amount.abs()) || bySymbol(a, b),
  );
  const shown = byMagnitude.slice(0, MAX_NAMED_ROWS).sort(byAmountDesc);
  const rest = byMagnitude.slice(MAX_NAMED_ROWS);
  const entries: Entry[] = [...shown];
  if (rest.length > 0) {
    entries.push({
      key: "others",
      label: `Otras (${rest.length})`,
      href: null,
      amount: sum(rest),
      closed: false,
    });
  }
  entries.push(...extras);

  const largest = entries.reduce(
    (max, entry) => (entry.amount.abs().gt(max) ? entry.amount.abs() : max),
    ZERO,
  );
  const total = sum(entries);
  return {
    rows: entries.map((entry) => ({
      key: entry.key,
      label: entry.label,
      href: entry.href,
      text: formatMoney(entry.amount, { signed: true }),
      tone: toneOf(entry.amount, 2),
      ratio: largest.isZero() ? 0 : entry.amount.div(largest).toNumber(),
      closed: entry.closed,
    })),
    totalText: formatMoney(total, { signed: true }),
    totalTone: entries.length === 0 ? null : toneOf(total, 2),
    note,
  };
}

const href = (symbol: string) => `/positions/${encodeURIComponent(symbol)}`;

/**
 * - **Total:** por símbolo, lo realizado + lo no realizado + los dividendos (abiertas y cerradas).
 *   Las comisiones sueltas, intereses e impuestos van en una fila aparte si no son cero, así la suma
 *   coincide con la ganancia total. Una posición abierta sin precio no entra (no se sabe su valor).
 * - **Hoy:** el cambio del día en dinero de cada posición abierta que tiene cierre anterior.
 */
export function buildContributionView(
  valued: ValuedPortfolio,
  totals: Pick<EngineTotals, "interest" | "fees" | "taxes">,
): ContributionView {
  const totalEntries: Entry[] = [];
  const dayEntries: Entry[] = [];
  const unpriced: string[] = [];

  for (const position of valued.positions) {
    const base = {
      key: position.symbol,
      label: position.symbol,
      href: href(position.symbol),
      closed: !position.isOpen,
    };
    if (position.isOpen && position.unrealizedPnl === null) {
      unpriced.push(position.symbol);
    } else {
      totalEntries.push({
        ...base,
        amount: position.realizedPnl
          .plus(position.unrealizedPnl ?? ZERO)
          .plus(position.dividends),
      });
    }
    if (position.isOpen && position.dayChange !== null) {
      dayEntries.push({ ...base, amount: position.dayChange });
    }
  }

  const other = totals.interest.minus(totals.fees).minus(totals.taxes);
  const extras: Entry[] = other.isZero()
    ? []
    : [
        {
          key: "other",
          label: "Comisiones y otros",
          href: null,
          amount: other,
          closed: false,
        },
      ];

  return {
    total: toModeView(
      totalEntries,
      extras,
      unpriced.length === 0
        ? null
        : `Sin precio: ${unpriced.join(", ")}. No entra en la suma.`,
    ),
    day: toModeView(dayEntries, [], null),
  };
}
