import { describe, expect, it, vi } from "vitest";
import { createTavilySearch, parseTavilyResponse } from "../news/tavily";

// Sin red: `fetch` es un doble que devuelve una respuesta fija.
const fakeFetch = () =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: "<b>Hola</b>",
              url: "https://www.example.com/x",
              content: "Texto",
              published_date: "2026-09-29T10:00:00Z",
            },
            { title: "Sin https", url: "http://example.com/y" },
          ],
        }),
      ),
  );

const bodyOf = (fetchImpl: ReturnType<typeof fakeFetch>): unknown =>
  JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));

describe("Tavily", () => {
  it("la búsqueda web manda solo la consulta (tema general) y limpia la respuesta", async () => {
    const fetchImpl = fakeFetch();
    const client = createTavilySearch("key", fetchImpl);
    const items = await client.searchWeb("VXUS expense ratio");
    const body = bodyOf(fetchImpl);
    expect(body).toMatchObject({
      query: "VXUS expense ratio",
      topic: "general",
      include_raw_content: false,
    });
    expect(body).not.toHaveProperty("days");
    expect(items).toEqual([
      {
        title: "Hola",
        url: "https://www.example.com/x",
        publishedAt: "2026-09-29",
        site: "example.com",
        snippet: "Texto",
      },
    ]);
  });

  it("las noticias siguen pidiendo el tema news con los días", async () => {
    const fetchImpl = fakeFetch();
    await createTavilySearch("key", fetchImpl).search("NVDA stock news", 7);
    expect(bodyOf(fetchImpl)).toMatchObject({
      query: "NVDA stock news",
      topic: "news",
      days: 7,
    });
  });

  it("un HTTP con error lanza y una respuesta rara queda vacía", async () => {
    const failing = vi.fn<typeof fetch>(
      async () => new Response("no", { status: 500 }),
    );
    await expect(
      createTavilySearch("key", failing).searchWeb("abc def"),
    ).rejects.toThrow("tavily: HTTP 500");
    expect(parseTavilyResponse({ nope: true })).toEqual([]);
  });
});
