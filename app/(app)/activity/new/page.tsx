import { PageHeader } from "@/components/app/stat";
import { TransactionForm } from "@/components/app/transaction-form";
import { toLocalInput } from "@/lib/portfolio/time";

export default function NewTransactionPage() {
  return (
    <div className="flex flex-col gap-2">
      <PageHeader title="Nueva operación" />
      <TransactionForm
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
        }}
      />
    </div>
  );
}
