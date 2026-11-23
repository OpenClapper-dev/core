import type { ComponentChildren, ComponentType } from "preact";

/** Renders a demo twice, Light and Dark side by side, the way every export card does. */
export function Pair({ Demo }: { Demo: ComponentType }) {
  return (
    <div className="pair">
      <div className="half" data-theme="light"><Demo /></div>
      <div className="half" data-theme="dark"><Demo /></div>
    </div>
  );
}

/** A small mono caption above a row of specimens. */
export const L = ({ children }: { children: ComponentChildren }) => <p className="l">{children}</p>;
