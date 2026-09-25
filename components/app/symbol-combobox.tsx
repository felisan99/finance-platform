"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { searchInstruments } from "@/app/(app)/activity/actions";
import type { InstrumentSearchResult } from "@/lib/market-data";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 350;

/**
 * Campo de símbolo con autocompletado (spec §10.3): mientras se escribe, busca en el proveedor a
 * través de una Server Action con límite de uso. Es un combobox accesible (rol, `aria-expanded`,
 * lista con `role="listbox"`). Si la búsqueda falla o no hay resultados, el símbolo se puede
 * escribir a mano: el servidor lo verifica igual.
 *
 * `onCommit` avisa cuándo la persona terminó con el símbolo: al elegir uno de la lista o al salir del
 * campo con algo escrito. No se llama en cada tecla.
 */
export function SymbolCombobox({
  id,
  name,
  defaultValue,
  invalid,
  describedBy,
  onCommit,
}: {
  id: string;
  name: string;
  defaultValue: string;
  invalid: boolean;
  describedBy?: string | undefined;
  onCommit?: ((symbol: string) => void) | undefined;
}) {
  const listId = useId();
  const [value, setValue] = useState(defaultValue);
  /** Resultado de una búsqueda y la consulta a la que pertenece: si ya no coincide, no se muestra. */
  const [resolved, setResolved] = useState<{
    query: string;
    items: InstrumentSearchResult[];
    note: string | null;
  } | null>(null);
  const [open, setOpen] = useState(false);
  // Solo se busca cuando la persona tipeó: no al cargar el formulario con un valor ya elegido.
  const [typed, setTyped] = useState(false);

  // Al salir del campo se espera un momento antes de avisar: si la salida fue por tocar una sugerencia,
  // la elección llega primero y el valor ya es el símbolo elegido, no lo que se había tipeado.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(commitTimer.current), []);

  const query = value.trim();

  useEffect(() => {
    if (!typed || query.length < MIN_CHARS) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const response = await searchInstruments(query);
      if (cancelled) return;
      setResolved(
        response.ok
          ? {
              query,
              items: response.results,
              note:
                response.results.length === 0
                  ? "Sin resultados: podés escribir el símbolo a mano."
                  : null,
            }
          : { query, items: [], note: response.message },
      );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typed, query]);

  const current = resolved?.query === query ? resolved : null;
  const results = current?.items ?? [];
  const note = current?.note ?? null;
  const showList = open && typed && (results.length > 0 || note !== null);

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        value={value}
        onChange={(event) => {
          setTyped(true);
          setValue(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          clearTimeout(commitTimer.current);
          setOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 120);
          clearTimeout(commitTimer.current);
          commitTimer.current = setTimeout(() => {
            const typedSymbol = valueRef.current.trim();
            if (typedSymbol !== "") onCommit?.(typedSymbol);
          }, 250);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        placeholder="VOO, AAPL, BRK-B…"
        maxLength={40}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {results.map((result) => (
            <li
              key={result.symbol}
              role="option"
              aria-selected={result.symbol === value}
              // onMouseDown y no onClick: el `blur` del campo cerraría la lista antes del clic.
              onMouseDown={(event) => {
                event.preventDefault();
                setTyped(false);
                setValue(result.symbol);
                setResolved(null);
                setOpen(false);
                onCommit?.(result.symbol);
              }}
              className="flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted"
            >
              {/* Flex y no en línea: así el nombre largo se corta con «…» en vez de pisar el tipo. */}
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 font-medium">{result.symbol}</span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {result.name}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {result.type === "ETF" ? "ETF" : "Acción"}
              </span>
            </li>
          ))}
          {results.length === 0 && note && (
            <li
              role="presentation"
              className="px-2 py-2 text-xs text-muted-foreground"
            >
              {note}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
