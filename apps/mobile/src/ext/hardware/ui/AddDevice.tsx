import { useEffect, useState } from "react";
import { CATALOGUE, modelName, modelOf, type Model, type ScannedDevice } from "@openclapper/ext-hardware";
import { canCall } from "../../../api";
import { Banner, Block, Button, Empty, Header, Hint, Input, ListRow, Row, Screen, SectionLabel, toast } from "../../../ui";
import { addDevice } from "../library";
import { request, useHardware } from "../proxy";
import { TYPE_LOOK } from "./parts";

/**
 * Add a device (docs/features/hardware.md, U6): the proxy phone scans, the list shows what it found with the likely
 * model beside the catalogue; pick one, confirm the model and name it. An Aputure light is then paired into the
 * phone's mesh. A device reached over Wi-Fi (the transmitter) is added from the catalogue without a scan.
 */
export function AddDevice({ back, opened }: { back: () => void; opened: (id: string) => void }) {
  const { state, scan } = useHardware();
  const [picked, setPicked] = useState<ScannedDevice | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const proxy = !!state?.proxy;
  useEffect(() => { if (proxy) request({ type: "scan", on: true }); return () => request({ type: "scan", on: false }); }, [proxy]);

  const save = async () => {
    if (!model || busy) return;
    setBusy(true);
    try {
      const d = await addDevice(model.id, model.transport === "wifi" ? null : picked!.address, name.trim() || undefined);
      request({ type: "sync" });
      if (model.transport === "mesh") setTimeout(() => request({ type: "provision", device: d.id }), 500);
      toast(model.transport === "mesh" ? `${d.name} added; pairing it now` : `${d.name} added`);
      opened(d.id);
    } catch (e) { toast(`Not added: ${(e as Error).message}`, "danger"); } finally { setBusy(false); }
  };

  if (model) {
    return (
      <Screen header={<Header title={modelName(model)} sub={picked ? picked.address : "Over its own Wi-Fi"} onBack={() => setModel(null)} />}>
        <Block>
          <Row label="Name"><Input value={name} onChangeText={setName} placeholder={modelName(model)} maxLength={120} /></Row>
          <Hint>{model.pairing}</Hint>
          <Button icon="plus" label={model.transport === "mesh" ? "Add and pair" : "Add"} busy={busy} disabled={!canCall()} onPress={() => void save()} />
        </Block>
      </Screen>
    );
  }
  if (picked) {
    const likely = picked.kinds.map((k) => modelOf(k)).filter((x): x is Model => !!x);
    const others = CATALOGUE.filter((x) => x.transport !== "wifi" && !likely.includes(x));
    return (
      <Screen header={<Header title={picked.name ?? picked.address} sub="Which model is it?" onBack={() => setPicked(null)} />}>
        {likely.length > 0 && <Block><SectionLabel>Likely</SectionLabel>{likely.map((x) => <ListRow key={x.id} icon={TYPE_LOOK[x.type].icon} title={modelName(x)} onPress={() => { setModel(x); setName(""); }} />)}</Block>}
        <Block><SectionLabel>Every model</SectionLabel>{others.map((x) => <ListRow key={x.id} icon={TYPE_LOOK[x.type].icon} title={modelName(x)} onPress={() => { setModel(x); setName(""); }} />)}</Block>
      </Screen>
    );
  }
  return (
    <Screen header={<Header title="Add a device" onBack={back} />}>
      <Block>
        {!proxy && <Banner kind="info" title="No proxy" meta="Scanning runs on the device that holds the connections: switch the proxy on in Hardware." />}
        {scan?.phase === "error" && <Banner kind="danger" title={scan.message ?? "Scan failed"} />}
        <SectionLabel>{scan?.phase === "scanning" ? "Looking for devices…" : "Found nearby"}</SectionLabel>
        {!scan?.found.length && <Empty icon="bluetooth" title={scan?.phase === "scanning" ? "Looking…" : "Nothing found"} body="Switch the device on and keep it close to the device." />}
        {scan?.found.map((f) => (
          <ListRow key={f.address} icon={f.kinds.length ? TYPE_LOOK[modelOf(f.kinds[0])!.type].icon : "bluetooth"} title={f.name ?? f.address}
            meta={[f.kinds.length ? `Likely ${modelName(modelOf(f.kinds[0])!)}` : null, f.address, f.rssi !== null ? `${f.rssi} dBm` : null].filter(Boolean).join(" · ")} onPress={() => setPicked(f)} />
        ))}
        {proxy && <Button kind="secondary" icon="refresh" label="Scan again" disabled={scan?.phase === "scanning"} onPress={() => request({ type: "scan", on: true })} />}
      </Block>
      <Block>
        <SectionLabel>Without a scan</SectionLabel>
        {CATALOGUE.filter((x) => x.transport === "wifi").map((x) => <ListRow key={x.id} icon={TYPE_LOOK[x.type].icon} title={modelName(x)} meta="Reached over its own Wi-Fi" onPress={() => { setPicked(null); setModel(x); setName(""); }} />)}
      </Block>
    </Screen>
  );
}
