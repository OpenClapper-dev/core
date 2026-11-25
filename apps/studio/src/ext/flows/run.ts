// The Flows extension's channel in the Studio (docs/features/flows.md, "Running on the phone"): what the proxy phone
// says about a flow it runs, and the requests to start and stop one.
import { useEffect, useState } from "preact/hooks";
import { FLOWS_CHANNEL, type FlowRequest, type RunState } from "@openclapper/ext-flows";
import { sendLink, usePhoneLink } from "../../phoneLink";

let run: (RunState & { receivedAt: number }) | null = null;
const listeners = new Set<() => void>();
function onMessage(m: Record<string, unknown>) {
  if (m.ch !== FLOWS_CHANNEL || m.type !== "state") return;
  run = { ...(m as unknown as RunState), receivedAt: performance.now() };
  for (const cb of listeners) cb();
}
export const requestRun = (r: FlowRequest) => sendLink({ ch: FLOWS_CHANNEL, ...r });

/** The run on the phone as last reported (null: none heard). */
export function useRun() {
  const link = usePhoneLink(onMessage);
  const [, tick] = useState(0);
  useEffect(() => { const cb = () => tick((n) => n + 1); listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
  useEffect(() => { if (link.open) requestRun({ type: "hello" }); }, [link.open]);
  return run;
}
