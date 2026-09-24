import { describe, expect, it, vi } from "vitest";
import { chunk, fetchAllPages, PAGE_SIZE } from "../paginate";

/** Simula PostgREST: `total` filas y respuestas de a lo sumo `serverMax` por pedido. */
function fakeTable(total: number, serverMax = PAGE_SIZE) {
  const calls: Array<[number, number]> = [];
  const fetchPage = vi.fn(async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to, from + serverMax - 1, total - 1);
    const data =
      from > end
        ? []
        : Array.from({ length: end - from + 1 }, (_, i) => from + i);
    return { data, error: null };
  });
  return { fetchPage, calls };
}

describe("fetchAllPages", () => {
  it("una tabla vacía devuelve un arreglo vacío con un solo pedido", async () => {
    const { fetchPage, calls } = fakeTable(0);
    expect(await fetchAllPages(fetchPage)).toEqual([]);
    expect(calls).toEqual([[0, 999]]);
  });

  it("menos de una página: un pedido", async () => {
    const { fetchPage } = fakeTable(37);
    expect(await fetchAllPages(fetchPage)).toHaveLength(37);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("2,5 páginas: trae todo, en orden y sin repetir", async () => {
    const { fetchPage, calls } = fakeTable(2500);
    const rows = await fetchAllPages(fetchPage);
    expect(rows).toHaveLength(2500);
    expect(rows).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("exactamente una página completa: hace falta un pedido más para saber que terminó", async () => {
    const { fetchPage, calls } = fakeTable(1000);
    expect(await fetchAllPages(fetchPage)).toHaveLength(1000);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("el caso del bug: 1260 filas (5 años de un instrumento) no se truncan en 1000", async () => {
    const { fetchPage } = fakeTable(1260);
    expect(await fetchAllPages(fetchPage)).toHaveLength(1260);
  });

  it("respeta un tamaño de página propio", async () => {
    const { fetchPage, calls } = fakeTable(25, 10);
    expect(await fetchAllPages(fetchPage, { pageSize: 10 })).toHaveLength(25);
    expect(calls).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
  });

  it("propaga el error de una página del medio", async () => {
    let n = 0;
    const fetchPage = async () => {
      n++;
      if (n === 2) return { data: null, error: { message: "boom" } };
      return { data: Array.from({ length: 1000 }, () => 1), error: null };
    };
    await expect(fetchAllPages(fetchPage)).rejects.toThrow("db: boom");
  });

  it("se corta con un tope de seguridad si el servidor ignora el rango", async () => {
    const forever = async () => ({
      data: Array.from({ length: 1000 }, () => 1),
      error: null,
    });
    await expect(fetchAllPages(forever, { maxRows: 5000 })).rejects.toThrow(
      /demasiadas filas/,
    );
  });

  it("`data: null` sin error se toma como página vacía", async () => {
    expect(
      await fetchAllPages(async () => ({ data: null, error: null })),
    ).toEqual([]);
  });
});

describe("chunk", () => {
  it("parte en grupos y conserva el orden", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });
});
