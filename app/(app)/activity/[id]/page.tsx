import { notFound } from "next/navigation";
import { z } from "zod";
import { DeleteTransactionButton } from "@/components/app/delete-transaction-button";
import { PageHeader } from "@/components/app/stat";
import {
  TransactionForm,
  type TransactionFormValues,
} from "@/components/app/transaction-form";
import { createClient } from "@/lib/db/server";
import { D, d } from "@/lib/engine";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import { portfolioOfAccount } from "@/lib/portfolio/portfolio-scope";
import { getInstruments, getTransactionRow } from "@/lib/portfolio/queries";
import type { TransactionRow } from "@/lib/portfolio/rows";
import { toLocalInput } from "@/lib/portfolio/time";

const plain = (value: string | null) =>
  value === null ? "" : d(value).toFixed();

/** "10 por 1" o "1 por 10" a partir de la razón guardada (nuevas / viejas). */
function splitParts(ratio: string | null): {
  splitNew: string;
  splitOld: string;
} {
  if (ratio === null) return { splitNew: "", splitOld: "1" };
  const value = d(ratio);
  if (value.gte(1)) return { splitNew: value.toFixed(), splitOld: "1" };
  return {
    splitNew: "1",
    splitOld: new D(1).div(value).toDecimalPlaces(4).toFixed(),
  };
}

function initialValues(
  row: TransactionRow,
  symbol: string,
  portfolio: string,
): TransactionFormValues {
  return {
    type: row.type,
    symbol,
    quantity: plain(row.quantity),
    price: plain(row.price),
    fee:
      row.type === "BUY" || row.type === "SELL"
        ? plain(row.fee).replace(/^0$/, "")
        : "",
    amount: plain(row.amount),
    ...splitParts(row.split_ratio),
    executedAt: toLocalInput(new Date(row.executed_at)),
    notes: row.notes ?? "",
    portfolio,
  };
}

export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [found, context] = await Promise.all([
    getTransactionRow(supabase, id),
    getPortfolioContext(supabase),
  ]);
  const portfolio = found
    ? portfolioOfAccount(context.portfolios, found.accountId)
    : null;
  if (!found || !portfolio) notFound();
  const { row } = found;

  const instrument = row.instrument_id
    ? (await getInstruments(supabase, [row.instrument_id]))[0]
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <PageHeader title="Editar operación" />
        <TransactionForm
          id={row.id}
          portfolios={context.portfolios.map(({ id, name }) => ({ id, name }))}
          initial={initialValues(row, instrument?.symbol ?? "", portfolio.id)}
        />
      </div>
      <DeleteTransactionButton id={row.id} imported={row.source !== "manual"} />
    </div>
  );
}
