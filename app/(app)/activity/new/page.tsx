import { PageHeader } from "@/components/app/stat";
import { TransactionForm } from "@/components/app/transaction-form";
import { createClient } from "@/lib/db/server";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import { toLocalInput } from "@/lib/portfolio/time";

export default async function NewTransactionPage() {
  const { portfolios, current } = await getPortfolioContext(
    await createClient(),
  );
  return (
    <div className="flex flex-col gap-2">
      <PageHeader title="Nueva operación" />
      <TransactionForm
        portfolios={portfolios.map(({ id, name }) => ({ id, name }))}
        initial={{
          type: "BUY",
          symbol: "",
          quantity: "",
          price: "",
          fee: "",
          amount: "",
          splitNew: "",
          splitOld: "1",
          // La hora se arma en el servidor: así no hay diferencia con el cliente al hidratar.
          executedAt: toLocalInput(new Date()),
          notes: "",
          // Arranca en el portafolio que se está mirando.
          portfolio: current?.id ?? "",
        }}
      />
    </div>
  );
}
