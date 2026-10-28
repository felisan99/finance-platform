import { describe, expect, it } from "vitest";
import { activeToolsAfter } from "../agent";
import { ASSET_TOOL, MEMORY_TOOL, NEWS_TOOL, WEB_TOOL } from "../tools";

const ALL = [
  "get_positions",
  "get_asset_info",
  NEWS_TOOL,
  WEB_TOOL,
  MEMORY_TOOL,
];
const step = (...names: string[]) => ({
  toolCalls: names.map((toolName) => ({ toolName })),
});

describe("activeToolsAfter", () => {
  it("sin contenido externo leído, todas las tools siguen activas", () => {
    expect(activeToolsAfter([], ALL)).toBeNull();
    expect(activeToolsAfter([step("get_positions")], ALL)).toBeNull();
  });

  it("después de search_news o web_search, la memoria queda afuera por el resto del turno", () => {
    const withoutMemory = ALL.filter((name) => name !== MEMORY_TOOL);
    expect(activeToolsAfter([step(NEWS_TOOL)], ALL)).toEqual(withoutMemory);
    expect(activeToolsAfter([step(WEB_TOOL), step()], ALL)).toEqual(
      withoutMemory,
    );
    expect(
      activeToolsAfter(
        [step("get_positions"), step(WEB_TOOL, MEMORY_TOOL)],
        ALL,
      ),
    ).toEqual(withoutMemory);
  });

  it("después de get_asset_info (texto de la empresa del proveedor), la memoria queda afuera", () => {
    expect(activeToolsAfter([step(ASSET_TOOL)], ALL)).toEqual(
      ALL.filter((name) => name !== MEMORY_TOOL),
    );
  });

  it("sin memoria ofrecida no hay nada que sacar", () => {
    expect(
      activeToolsAfter([step(WEB_TOOL)], ["get_positions", WEB_TOOL]),
    ).toBeNull();
  });
});
