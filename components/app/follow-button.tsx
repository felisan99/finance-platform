"use client";

import { Star, StarOff } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  addToWatchlist,
  removeFromWatchlist,
  type WatchlistState,
} from "@/app/(app)/watchlist/actions";

const initialState: WatchlistState = { status: "idle" };

/**
 * Seguir o dejar de seguir un símbolo desde su detalle. Con `leaveOnUnfollow` (símbolos que se
 * siguen pero no se tienen) vuelve a la Watchlist al dejar de seguir: la página del símbolo ya
 * no existiría.
 */
export function FollowButton({
  symbol,
  followed,
  leaveOnUnfollow = false,
}: {
  symbol: string;
  followed: boolean;
  leaveOnUnfollow?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    followed ? removeFromWatchlist : addToWatchlist,
    initialState,
  );
  const Icon = followed ? StarOff : Star;
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="symbol" value={symbol} />
      {followed && leaveOnUnfollow && (
        <input type="hidden" name="next" value="watchlist" />
      )}
      <Button type="submit" variant="outline" size="lg" disabled={pending}>
        <Icon aria-hidden="true" />
        {pending ? "Un momento…" : followed ? "Dejar de seguir" : "Seguir"}
      </Button>
      {state.status === "error" && (
        <p
          role="alert"
          className="max-w-56 text-right text-xs text-destructive"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
