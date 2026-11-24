import { useState } from "react";
import { Image } from "react-native";
import { isOfflineMode } from "../net";
import { setPrefs, usePrefs } from "../prefs";
import { projects } from "../projects";
import { settings, setSettings } from "../settings";
import { cacheBytes } from "../media/cache";
import { keepOnPhone } from "../media/library";
import { discard, flush, queue, queuedUri, retry, useQueueCounts } from "../media/queue";
import { stateOf } from "../media/steps";
import { Block, Button, confirm, Header, Hint, Icon, ListRow, Screen, toast, Toggle, useTheme } from "../ui";
import { addOfflineSection, addSetupPage, addSetupRow, openSetup } from "./Setup";

/**
 * Setup's Uploads page (docs/rewrite/03-capture.md, "Upload queue"): what is not on the server yet,
 * photo by photo, with Retry and Discard for a stuck one; originals on Wi-Fi only. And the Offline
 * page's second switch: keep the project's thumbnails and previews on the phone.
 */
const STATE = { waiting: "Waiting to upload", preview: "Preview sent, the original waits", stuck: "Stuck: the server refused it" } as const;

function UploadsPage({ back }: { back: () => void }) {
  const { c } = useTheme();
  const q = queue.use();
  const prefs = usePrefs();
  const names = projects.use();
  const counts = useQueueCounts();
  return (
    <Screen header={<Header title="Uploads" sub={isOfflineMode() ? "Offline mode: nothing is sent" : counts.waiting ? `${counts.waiting} waiting` : "All sent"} onBack={back} />}
      footer={counts.waiting > counts.stuck ? <Button style={{ flex: 1 }} icon="refresh" label="Send now" disabled={isOfflineMode()} onPress={() => void flush()} /> : undefined}>
      <Toggle icon="wifi" label="Originals on Wi-Fi only" meta="Thumbnail and preview go at once; the original waits for Wi-Fi." value={prefs.originalsOnWifi} onChange={(v) => { setPrefs({ originalsOnWifi: v }); if (!v) void flush(); }} />
      {q.map((x) => {
        const st = stateOf(x);
        const uri = queuedUri(x);
        return (
          <ListRow key={x.id} title={x.meta.name}
            meta={`${STATE[st]}${x.error && st === "stuck" ? `: ${x.error}` : ""} · ${names.find((p) => p.id === x.meta.project_id)?.name ?? "another project"}`}
            trailing={st === "stuck" ? (
              <>
                <Button kind="secondary" label="Retry" onPress={() => retry(x.id)} />
                <Button kind="ghost" label="Discard" onPress={() => void confirm({ title: "Discard this photo?", body: "It is not on the server: it is deleted from this device for good.", confirmLabel: "Discard", danger: true, icon: "trash" }).then((ok) => { if (ok === true) { discard(x.id); toast("Discarded", "neutral"); } })} />
              </>
            ) : uri ? <Image source={{ uri }} style={{ width: 44, height: 44, borderRadius: 6 }} /> : <Icon name={st === "preview" ? "cloud-upload" : "clock"} color={c.textDim} />}
          />
        );
      })}
      {!q.length && <Block><Hint>Everything is on the server.</Hint></Block>}
      <Block><Hint>A photo is stored on this device first and is never deleted because the server refused it. Thumbnail and preview go first, the original after; the device removes its copy of an original once the server has it.</Hint></Block>
    </Screen>
  );
}

function KeepProject() {
  const local = settings.use();
  const [bytes, setBytes] = useState(() => cacheBytes());
  return (
    <>
      <Toggle icon="download" label="Keep the project on this device" meta={local.keepProject ? `Thumbnails and previews are kept here (${Math.round(bytes / 1e6)} MB); originals stay on the server.` : "Its thumbnails and previews are stored here, so Media works without a connection."}
        value={local.keepProject} onChange={(v) => { setSettings({ keepProject: v }); if (v) void keepOnPhone().then(() => setBytes(cacheBytes())); }} />
    </>
  );
}

addSetupRow({ id: "uploads", icon: "cloud-upload", label: "Uploads", useMeta: () => { const q = queue.use(); const stuck = q.filter((x) => x.stuck).length; return stuck ? `${stuck} stuck, ${q.length} waiting` : q.length ? `${q.length} waiting` : "All sent"; }, open: () => openSetup("uploads") });
addSetupPage("uploads", (back) => <UploadsPage back={back} />);
addOfflineSection(KeepProject);
