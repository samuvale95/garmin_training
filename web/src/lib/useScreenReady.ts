"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { declareScreen, setScreenReady, undeclareScreen } from "./tracker";

/** Tells the interaction log when this screen's content is actually up, so its load time
 * (`screen_ready`) and give-ups (`load_abandon`) are measured from the screen itself
 * rather than guessed from skeletons -- a blank screen or a custom loader fools the guess.
 *
 * `ready` is true once the screen shows *something final*: its data, an empty state or an
 * error. Call it before any early return. `path` is only for views mounted outside their
 * own route (the tab pager keeps all four tabs mounted); it defaults to the current one.
 */
export function useScreenReady(ready: boolean, path?: string): void {
  const pathname = usePathname();
  const screen = path ?? pathname;

  useEffect(() => {
    declareScreen(screen);
    return () => undeclareScreen(screen);
  }, [screen]);

  useEffect(() => {
    setScreenReady(screen, ready);
  }, [screen, ready]);
}
