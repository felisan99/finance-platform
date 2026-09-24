import type { Dec } from "@/lib/engine";
import { EMPTY, formatMoney, formatPercent } from "@/lib/portfolio/format";
import { toneOf } from "@/lib/portfolio/tone";
import { PnlText } from "./pnl-text";

/**
 * Ganancia o pérdida en color, SIEMPRE con signo y flecha: el color solo no alcanza (daltonismo,
 * modo de alto contraste). `kind` decide si es dinero o porcentaje (la fracción va sin multiplicar).
 */
export function Pnl({
  value,
  kind,
  className,
}: {
  value: Dec | null;
  kind: "money" | "percent";
  className?: string;
}) {
  const tone = toneOf(value, kind === "money" ? 2 : 4);
  if (value === null || tone === null) {
    return <PnlText text={EMPTY} tone={null} className={className} />;
  }
  const text =
    kind === "money"
      ? formatMoney(value, { signed: true })
      : formatPercent(value, { signed: true });
  return <PnlText text={text} tone={tone} className={className} />;
}
