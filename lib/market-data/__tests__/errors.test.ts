import { describe, expect, it } from "vitest";
import {
  MarketDataError,
  classifyYahooError,
  describeError,
  isRetryable,
} from "../errors";
import { httpError } from "./helpers";

describe("classifyYahooError", () => {
  it.each([
    ["No data found, symbol may be delisted", "NOT_FOUND"],
    ["Quote not found for ticker symbol: ZZZZ", "NOT_FOUND"],
    ["Symbol not found", "NOT_FOUND"],
  ])("mensaje %j → %s", (message, kind) => {
    expect(classifyYahooError(new Error(message), "ZZZZ")).toMatchObject({
      kind,
      symbol: "ZZZZ",
    });
  });

  it("HTTP 404 → NOT_FOUND, 429 → RATE_LIMITED, 5xx/401/403 → UNAVAILABLE", () => {
    expect(classifyYahooError(httpError(404)).kind).toBe("NOT_FOUND");
    expect(classifyYahooError(httpError(429)).kind).toBe("RATE_LIMITED");
    for (const status of [500, 502, 503, 401, 403]) {
      expect(classifyYahooError(httpError(status)).kind).toBe("UNAVAILABLE");
    }
  });

  it("ENOTFOUND (DNS) no es un símbolo desconocido: es un error de red que se reintenta", () => {
    const error = classifyYahooError(
      new Error("getaddrinfo ENOTFOUND query2.finance.yahoo.com"),
    );
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.retryable).toBe(true);
  });

  it("clasifica por nombre los errores de validación y de pedido", () => {
    const named = (name: string) => Object.assign(new Error("x"), { name });
    expect(classifyYahooError(named("FailedYahooValidationError")).kind).toBe(
      "BAD_DATA",
    );
    expect(classifyYahooError(named("BadRequestError")).kind).toBe(
      "BAD_REQUEST",
    );
    expect(classifyYahooError(named("InvalidOptionsError")).kind).toBe(
      "BAD_REQUEST",
    );
  });

  it("un valor que no es Error también se clasifica", () => {
    expect(classifyYahooError("boom").kind).toBe("UNAVAILABLE");
    expect(classifyYahooError(undefined).kind).toBe("UNAVAILABLE");
  });

  it("deja pasar tal cual un MarketDataError", () => {
    const original = new MarketDataError("BAD_DATA", "x");
    expect(classifyYahooError(original)).toBe(original);
  });

  it("solo RATE_LIMITED y UNAVAILABLE son reintentables", () => {
    const kinds = [
      "NOT_FOUND",
      "RATE_LIMITED",
      "UNAVAILABLE",
      "BAD_DATA",
      "BAD_REQUEST",
    ] as const;
    expect(
      kinds.filter((k) => isRetryable(new MarketDataError(k, "x"))),
    ).toEqual(["RATE_LIMITED", "UNAVAILABLE"]);
    expect(isRetryable(new Error("x"))).toBe(false);
  });
});

describe("describeError", () => {
  it("resume un MarketDataError con tipo y símbolo", () => {
    expect(
      describeError(
        new MarketDataError("NOT_FOUND", "símbolo desconocido", {
          symbol: "KOS",
        }),
      ),
    ).toBe("NOT_FOUND KOS: símbolo desconocido");
  });

  it("acota el largo y quita caracteres de control", () => {
    const text = describeError(
      new Error(`línea1\nlínea2\u0000${"x".repeat(1000)}`),
    );
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text).not.toMatch(/[\n\u0000]/);
  });

  it("no rompe con valores raros", () => {
    expect(describeError(undefined)).toBe("undefined");
    expect(describeError("")).toBe("error desconocido");
  });
});
