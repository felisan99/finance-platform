import type { Dec } from "@/lib/engine";
import { EMPTY, formatMoney, formatPercent } from "@/lib/portfolio/format";
import { toneOf } from "@/lib/portfolio/tone";
import { PnlText } from "./pnl-text";

/**
 * Ganancia o pérdida en color, SIEMPRE con signo y flecha: el color solo no alcanza (daltonismo,
 * modo de alto contraste). `kind` decide si es dinero o porcentaje (la fracción va sin multiplicar).
 * `percent`, con dinero, agrega el porcentaje entre paréntesis con la misma flecha y el mismo
 * color: `▼ -US$ 18,40 (-1,10%)`.
 */
export function Pnl({
  value,
  kind,
  pill,
  percent,
  className,
}: {
  value: Dec | null;
  kind: "money" | "percent";
  /** Solo con `kind="money"`: la fracción que va entre paréntesis (`null`: no se agrega). */
  percent?: Dec | null;
  /** Con fondo teñido del color de la ganancia o la pérdida. */
  pill?: boolean;
  className?: string;
}) {
  const tone = toneOf(value, kind === "money" ? 2 : 4);
  if (value === null || tone === null) {
    return (
      <PnlText text={EMPTY} tone={null} pill={pill} className={className} />
    );
  }
  let text =
    kind === "money"
      ? formatMoney(value, { signed: true })
      : formatPercent(value, { signed: true });
  if (kind === "money" && percent != null) {
    text += ` (${formatPercent(percent, { signed: true })})`;
  }
  return <PnlText text={text} tone={tone} pill={pill} className={className} />;
}
