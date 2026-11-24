import { useEffect, useRef } from "react";

/**
 * Android's back button, inside the shell: the innermost screen that can go back takes it (a sheet,
 * a pushed page of an app), else the shell decides (to the first tab, then out of the app).
 */
const handlers: (() => boolean)[] = [];

/** While mounted (and `active`), `onBack` is asked first; it answers whether it went back. */
export function useBack(onBack: (() => void) | null | undefined, active = true) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active || !onBack) return;
    const h = () => { if (!ref.current) return false; ref.current(); return true; };
    handlers.push(h);
    return () => { const i = handlers.lastIndexOf(h); if (i >= 0) handlers.splice(i, 1); };
  }, [active, !!onBack]);
}

/** Called by the shell on a back press: whether a screen took it. */
export function handleBack(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]()) return true;
  return false;
}
