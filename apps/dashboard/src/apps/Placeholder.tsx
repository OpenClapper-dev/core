import { Empty } from "../ui";
import type { AppProps } from "./registry";

/** Stands in for apps that are ported in phases 4–6; proves focus/z-order with a second window. */
export function Placeholder({ win }: AppProps) {
  return (
    <div class="f-scroll" style={{ display: "flex" }}>
      <Empty icon="window-restore" title={win.title}>This app moves into the desktop in a later phase.</Empty>
    </div>
  );
}
