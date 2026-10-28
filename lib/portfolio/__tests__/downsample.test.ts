import { describe, expect, it } from "vitest";
import { downsampleSeries } from "../downsample";

function daily(start: string, n: number) {
  const base = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    close: 100 + i,
  }));
}

describe("downsampleSeries", () => {
  it("devuelve vacío para una serie vacía", () => {
    expect(
      downsampleSeries([], { dailyFrom: "2025-01-01", keepDates: new Set() }),
    ).toEqual([]);
  });

  it("no toca una serie corta", () => {
    const points = daily("2020-01-01", 2);
    expect(
      downsampleSeries(points, {
        dailyFrom: "2030-01-01",
        keepDates: new Set(),
      }),
    ).toEqual(points);
  });

  it("deja la serie diaria desde dailyFrom", () => {
    const points = daily("2024-01-01", 60);
    const out = downsampleSeries(points, {
      dailyFrom: "2024-01-01",
      keepDates: new Set(),
    });
    expect(out).toEqual(points);
  });

  it("pasa a semanal antes de dailyFrom y mantiene el orden", () => {
    const points = daily("2020-01-01", 700);
    const out = downsampleSeries(points, {
      dailyFrom: "2021-06-01",
      keepDates: new Set(),
    });
    expect(out.length).toBeLessThan(points.length * 0.5);
    const dates = out.map((p) => p.date);
    expect(dates).toEqual([...dates].sort());
    const recent = points.filter((p) => p.date >= "2021-06-01");
    expect(out.slice(-recent.length)).toEqual(recent);
  });

  it("conserva el primero, el último y los días de operaciones", () => {
    const points = daily("2020-01-01", 400);
    const keep = new Set(["2020-03-04", "2020-08-19"]);
    const out = downsampleSeries(points, {
      dailyFrom: "2030-01-01",
      keepDates: keep,
    });
    const dates = new Set(out.map((p) => p.date));
    expect(out[0]).toEqual(points[0]);
    expect(out.at(-1)).toEqual(points.at(-1));
    for (const day of keep) expect(dates.has(day)).toBe(true);
    expect(out.length).toBeLessThan(80);
  });

  it("una serie de 5 años queda en menos de la mitad de los bytes", () => {
    const points = daily("2021-10-28", 1826).filter((_, i) => i % 7 < 5);
    const out = downsampleSeries(points, {
      dailyFrom: "2025-10-28",
      keepDates: new Set([points[100]!.date]),
    });
    expect(JSON.stringify(out).length).toBeLessThan(
      JSON.stringify(points).length / 2,
    );
  });
});
