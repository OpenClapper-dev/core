import { useEffect } from "preact/hooks";
import { BinView } from "./BinView";
import type { AppProps } from "./registry";

/** The Recycle bin app: the project's bin in a window of its own. */
export function BinApp({ projectId, setTitle }: AppProps) {
  useEffect(() => { setTitle("Recycle bin"); }, []);
  return <div className="oc-app"><BinView root={{ project: projectId }} /></div>;
}
