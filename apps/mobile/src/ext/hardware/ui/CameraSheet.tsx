import { useEffect, useRef, useState } from "react";
import type { FixtureLive } from "@openclapper/ext-hardware";
import { Empty, Hint, Sheet } from "../../../ui";
import { useDevices } from "../library";
import { currentState, proxyRunning, startProxy, stopProxy, useHardware } from "../proxy";
import { DeviceScreen } from "./Device";
import { Card } from "./HardwareApp";

/**
 * The camera control "Hardware" (owner's decision 2026-11-24): the device cards over the camera, to set a light or
 * start the camera's recording without leaving it. When no phone holds the connections, this one does while the
 * sheet is open; a device's full screen opens from its card.
 */
export function HardwareSheet({ onClose }: { onClose: () => void }) {
  const devices = useDevices();
  const { state } = useHardware();
  const [open, setOpen] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!proxyRunning() && !currentState()?.proxy) { startProxy(); started.current = true; }
    return () => { if (started.current) stopProxy(); };
  }, []);
  const live = (id: string): FixtureLive | undefined => state?.devices.find((x) => x.id === id);
  const d = open ? devices.find((x) => x.id === open) : undefined;
  if (d) return <Sheet visible title={d.name} onClose={() => setOpen(null)} height={0.9} scroll={false}><DeviceScreen d={d} back={() => setOpen(null)} /></Sheet>;
  return (
    <Sheet visible title="Hardware" sub={started.current ? "This phone holds the connections while this is open" : state?.proxy ? `Through ${state.phone.name || "the proxy phone"}` : undefined} onClose={onClose} height={0.75}>
      {!devices.length && <Empty icon="light-fixture" title="No devices yet" body="Add them in the Hardware app." />}
      {devices.map((x) => <Card key={x.id} d={x} all={devices} live={live} proxy={!!state?.proxy} onOpen={() => setOpen(x.id)} />)}
      <Hint>The full list, adding devices and the key backup are in the Hardware app.</Hint>
    </Sheet>
  );
}
