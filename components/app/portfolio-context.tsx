import { PortfolioSwitcher } from "@/components/app/portfolio-switcher";
import type { PortfolioContext } from "@/lib/portfolio/current-portfolio";
import {
  ALL_PORTFOLIOS,
  ALL_PORTFOLIOS_LABEL,
  scopeName,
  scopeValue,
} from "@/lib/portfolio/portfolio-scope";

/**
 * El selector de portafolio para `PageHeader` (prop `context`): «Todos los portafolios» primero y
 * después cada uno. Con un solo portafolio no se muestra: la app se ve igual que antes de que
 * existieran varios.
 */
export function portfolioContextLine(context: PortfolioContext) {
  const { scope, portfolios } = context;
  if (!scope || portfolios.length < 2) return undefined;
  const current = scopeValue(scope);
  return (
    <PortfolioSwitcher
      key={current}
      options={[
        { value: ALL_PORTFOLIOS, label: ALL_PORTFOLIOS_LABEL },
        ...portfolios.map(({ id, name }) => ({ value: id, label: name })),
      ]}
      current={current}
    />
  );
}

/** Lo que se mira, como texto (la ficha de un activo): solo si hay más de un portafolio. */
export function portfolioNameLine(context: PortfolioContext) {
  const { scope, portfolios } = context;
  if (!scope || portfolios.length < 2) return undefined;
  return (
    <p className="truncate text-xs font-medium text-muted-foreground">
      {scopeName(scope)}
    </p>
  );
}
