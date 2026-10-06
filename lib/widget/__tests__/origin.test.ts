import { describe, expect, it } from "vitest";
import { appOrigin } from "../origin";

describe("appOrigin", () => {
  it("usa https si la petición llegó por HTTPS (Vercel)", () => {
    expect(appOrigin("portfolio.vercel.app", "https")).toBe(
      "https://portfolio.vercel.app",
    );
    expect(appOrigin("Portfolio.Vercel.App", "https,http")).toBe(
      "https://portfolio.vercel.app",
    );
  });

  it("http con puerto en desarrollo", () => {
    expect(appOrigin("localhost:3000", null)).toBe("http://localhost:3000");
  });

  it.each([
    null,
    "",
    "evil.com/path",
    "user@evil.com",
    "evil.com:3000:1",
    "evil .com",
    'evil.com";',
  ])("rechaza el host %j", (host) => {
    expect(appOrigin(host, "https")).toBeNull();
  });
});
