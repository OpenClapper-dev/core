import { useEffect, useState } from "react";
import { useKeepAwake } from "expo-keep-awake";
import { fixtureKind, fixtureKindName } from "@openclapper/vocab";
import { linkLabel, hub } from "../fixtures/hub";
import { setFixtureAsleep, useFixtures } from "../fixtures/library";
import { onProxyChange, reconnectAll, startProxy, studioTabs } from "../fixtures/proxy";
import type { Fixture } from "../fixtures/types";
import { linkOpen } from "../preview";
import { Banner, Block, Button, Empty, Hint, IconButton, ListRow, PushScreen, SectionLabel, toast, useTheme } from "../ui";

/**
 * Setup → Proxy (#307): while this screen is open the phone holds every paired light and battery and
 * runs what the Studio's Devices app sends. Sleep, wake and Reconnect all only (#318); the screen stays
 * on (Android stops Bluetooth in the background).
 */
export function Proxy() {
  useKeepAwake();
  const fixtures = useFixtures();
  const { c } = useTheme();
  const [, setTick] = useState(0);
  useEffect(() => {
    const off = onProxyChange(() => setTick((t) => t + 1));
    const stop = startProxy();
    return () => { off(); stop(); };
  }, []);
  const studios = studioTabs();
  const online = linkOpen();
  const [busy, setBusy] = useState<string | null>(null);
  const toggleSleep = (f: Fixture) => {
    setBusy(f.id);
    setFixtureAsleep(f.id, !f.asleep)
      .then(() => toast(f.asleep ? `${f.label} woken` : `${f.label} asleep`))
      .catch(() => toast("Could not change sleep: the server is not reachable", "danger"))
      .finally(() => setBusy(null));
  };
  return (
    <PushScreen title="Proxy" sub="Lights controlled from the Studio">
      <Block>
        {!online
          ? <Banner kind="warn" icon="cloud-off-outline" title="Not connected to the server" meta="The Studio cannot reach the lights until the phone is online." />
          : studios
            ? <Banner kind="ok" icon="monitor" title={`Studio attached (${studios} tab${studios === 1 ? "" : "s"})`} meta="Open Devices in the Studio to control the lights." />
            : <Banner kind="info" icon="monitor-off" title="No Studio open" meta="Open the Studio's Devices app on your computer." />}
        <Hint>Keep this screen open: the phone holds the lights only while it is shown, with the screen on.</Hint>
      </Block>
      <Block>
        <SectionLabel>{`${fixtures.length} paired`}</SectionLabel>
        {fixtures.length === 0 && <Empty icon="lightbulb-outline" title="Nothing paired" body="Pair lights from the Studio's Devices app." />}
        {fixtures.map((f) => {
          const s = hub.status(f.id);
          const k = fixtureKind(f.kindId);
          const battery = s.telemetry?.battery;
          return (
            <ListRow key={f.id} icon={f.asleep ? "sleep" : s.link === "ready" ? "check-circle-outline" : s.link === "failed" ? "alert-circle-outline" : "progress-clock"}
              title={f.label} meta={[k ? fixtureKindName(k) : f.kindId, f.asleep ? "Asleep · not connecting" : linkLabel(s), battery != null ? `${Math.round(battery)} %` : null].filter(Boolean).join(" · ")}
              iconColor={f.asleep ? c.textDisabled : undefined} titleColor={f.asleep ? c.textDim : undefined}
              trailing={<IconButton icon={f.asleep ? "weather-sunny" : "sleep"} label={f.asleep ? `Wake ${f.label}` : `Put ${f.label} to sleep`} disabled={busy === f.id || !online} onPress={() => toggleSleep(f)} />} />
          );
        })}
        {fixtures.some((f) => !f.asleep) && (
          <>
            <Button kind="secondary" icon="refresh" label="Reconnect all" onPress={() => { reconnectAll(); toast("Reconnecting, one device at a time"); }} />
            <Hint>Drops every connection and connects again. The lights keep their state.</Hint>
          </>
        )}
      </Block>
    </PushScreen>
  );
}
