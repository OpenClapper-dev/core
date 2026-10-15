import { useEffect, useState } from "react";
import { Text } from "react-native";
import { useApp } from "../appState";
import { useOnline } from "../net";
import { offlineDays, offlineProject, onProjectProgress, projectProgress, removeOfflineProject, saveProjectOffline } from "../offline";
import { shortTime } from "../shots";
import { onEditsChange, store } from "../storage";
import { useSync } from "../sync";
import { Banner, Block, Button, confirm, Hint, makeStyles, num, PushScreen, SectionLabel, SideBySide, toast, Toggle, type } from "../ui";

/** Rough size of one stored photo (1280 px JPEG), for the estimate before downloading. */
const PHOTO_BYTES = 250_000;
const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

/**
 * Setup → Offline: offline mode (nothing is sent until it is switched off), what waits on the
 * phone, and the active project kept on the phone (every photo downloaded, followed while online).
 */
export function Offline() {
  const s = useStyles();
  const app = useApp();
  const online = useOnline();
  const sync = useSync();
  const project = app.project;
  const [, rerender] = useState(0);
  useEffect(() => { const offs = [onProjectProgress(() => rerender((n) => n + 1)), onEditsChange(() => rerender((n) => n + 1))]; return () => { for (const off of offs) off(); }; }, []);
  const kept = offlineProject(project?.id ?? null);
  const progress = projectProgress();
  const running = !!progress && progress.projectId === project?.id;
  const edits = store.loadEdits().length;
  const days = offlineDays().filter((d) => d.day.project_id === project?.id).length;
  const serverShots = (app.shots.shots ?? []).filter((x) => !x.queued);
  const photos = serverShots.reduce((n, x) => n + x.photos.length, 0);
  const canDownload = online && !app.settings.offlineMode && app.shots.source === "server";

  const keep = async () => {
    if (!project) return;
    try {
      const r = await saveProjectOffline(project.id, project.name, serverShots);
      toast(`${project.name} is on this phone · ${mb(r.bytes)}`);
    } catch (e) {
      toast(`Saving stopped: ${e instanceof Error ? e.message : String(e)}. Try again; finished photos are kept.`, "danger");
    }
    rerender((n) => n + 1);
  };
  const remove = async () => {
    if (!project) return;
    const ok = await confirm({ title: `Remove ${project.name} from this phone?`, body: "Deletes the downloaded photos (those of offline days stay). Nothing on the server changes.", confirmLabel: "Remove", danger: true });
    if (ok !== true) return;
    removeOfflineProject(project.id);
    rerender((n) => n + 1);
    toast("Removed from the phone", "neutral");
  };

  return (
    <PushScreen title="Offline" sub={app.settings.offlineMode ? "Offline mode is on" : online ? "Connected" : "No connection"}>
      <Toggle icon="cloud-off-outline" label="Offline mode" meta="Nothing is sent or loaded: captures, decisions and edits wait on the phone. Saves battery and data where there is no signal. Switching it off sends everything."
        value={app.settings.offlineMode} onChange={(v) => app.setSettings((x) => ({ ...x, offlineMode: v }))} />
      <Block>
        <SectionLabel>Waiting on this phone</SectionLabel>
        <Text style={s.value}>{sync.pending ? `${sync.pending} shot${sync.pending === 1 ? "" : "s"} to upload` : "No shots to upload"}{edits ? ` · ${edits} edited shot${edits === 1 ? "" : "s"} to sync` : ""}</Text>
        <Hint>Queued shots show in Shots (filter Queued) and in History; you can tag, approve or archive them before they upload.</Hint>
        <Button kind="secondary" icon="cloud-upload-outline" label="Open Uploads" onPress={() => app.push({ name: "uploads" })} />
      </Block>
      <Block>
        <SectionLabel>{project ? `${project.name} on this phone` : "Project on this phone"}</SectionLabel>
        {kept ? (
          <>
            <Text style={s.value}>{kept.shots.length} shots · {mb(kept.bytes)}</Text>
            <Text style={s.meta}>Updated {shortTime(kept.savedAt)}. While online, new shots and photos follow automatically.</Text>
          </>
        ) : (
          <Hint>Downloads every photo of the project ({serverShots.length} shots, about {mb(photos * PHOTO_BYTES)}), so Shots and Review work without a connection.</Hint>
        )}
        {running && progress && <Text style={s.value}>Saving {progress.done} / {progress.total} photos…</Text>}
        {!canDownload && !kept && <Banner kind="offline" title="Needs a connection" meta="Keep the project on the phone before you go where there is no signal." />}
        {kept ? (
          <SideBySide>
            <Button style={{ flex: 1 }} kind="secondary" icon="refresh" label="Update now" onPress={() => void keep()} busy={running} disabled={!canDownload} />
            <Button style={{ flex: 1 }} kind="danger" icon="delete-outline" label="Remove" onPress={() => void remove()} disabled={running} />
          </SideBySide>
        ) : (
          <Button icon="download-outline" label="Keep on this phone" onPress={() => void keep()} busy={running} disabled={!canDownload || !project} />
        )}
        {days > 0 && <Text style={s.meta}>{days} shooting day{days === 1 ? "" : "s"} of this project also saved offline (Day tab).</Text>}
      </Block>
    </PushScreen>
  );
}

const useStyles = makeStyles((c) => ({
  value: { ...type("body", "bold"), color: c.text, ...num },
  meta: { ...type("small"), color: c.textDim, ...num },
}));
