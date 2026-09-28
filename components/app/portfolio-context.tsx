import { PortfolioSwitcher } from "@/components/app/portfolio-switcher";
import type { PortfolioContext } from "@/lib/portfolio/current-portfolio";

/**
 * El selector de portafolio para `PageHeader` (prop `context`). Con un solo portafolio no se
 * muestra: la app se ve igual que antes de que existieran varios.
 */
export function portfolioContextLine(context: PortfolioContext) {
  const { current, portfolios } = context;
  if (!current || portfolios.length < 2) return undefined;
  return (
    <PortfolioSwitcher
      key={current.id}
      portfolios={portfolios.map(({ id, name }) => ({ id, name }))}
      currentId={current.id}
    />
  );
}

/** El portafolio como texto (la ficha de un activo): solo si hay más de uno. */
export function portfolioNameLine(context: PortfolioContext) {
  const { current, portfolios } = context;
  if (!current || portfolios.length < 2) return undefined;
  return (
    <p className="truncate text-xs font-medium text-muted-foreground">
      {current.name}
    </p>
  );
}
