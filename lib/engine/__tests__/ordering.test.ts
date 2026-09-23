import { describe, expect, it } from "vitest";
import { sortTransactions } from "../ordering";

const t = (id: string, executed: string, created: string) => ({
  id,
  executedAt: new Date(executed),
  createdAt: new Date(created),
});

describe("sortTransactions", () => {
  it("ordena por executedAt", () => {
    const sorted = sortTransactions([
      t("b", "2026-03-09T22:34:00Z", "2026-09-01T00:00:00Z"),
      t("a", "2026-03-06T22:30:00Z", "2026-09-01T00:00:00Z"),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("desempata por createdAt", () => {
    const sorted = sortTransactions([
      t("late", "2026-03-09T22:34:00Z", "2026-09-02T00:00:00Z"),
      t("early", "2026-03-09T22:34:00Z", "2026-09-01T00:00:00Z"),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["early", "late"]);
  });

  it("conserva el orden de entrada en los empates completos", () => {
    const same = "2026-03-09T22:34:00Z";
    const sorted = sortTransactions([
      t("1", same, same),
      t("2", same, same),
      t("3", same, same),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  it("no muta el arreglo de entrada", () => {
    const input = [
      t("b", "2026-03-09T22:34:00Z", "2026-03-09T22:34:00Z"),
      t("a", "2026-03-06T22:30:00Z", "2026-03-06T22:30:00Z"),
    ];
    const snapshot = [...input];
    sortTransactions(input);
    expect(input).toEqual(snapshot);
  });
});
