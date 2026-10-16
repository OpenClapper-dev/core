import { useState } from "react";
import { ActivityIndicator, SectionList, Text, View } from "react-native";
import { File } from "expo-file-system";
import { useApp } from "../appState";
import { isOfflineMode } from "../net";
import { hhmm, shortTime } from "../shots";
import { store } from "../storage";
import { useSync } from "../sync";
import type { PendingUpload } from "../types";
import { discardPending, flush } from "../uploads";
import { Button, confirm, Empty, FIXED, Icon, makeStyles, num, PushScreen, RADIUS, SectionLabel, SideBySide, toast, type, useTheme } from "../ui";
import { FramedImage } from "../components/FramedImage";
import type { ViewSettings } from "../types";

const photoWord = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;

function missingCount(p: PendingUpload): number {
  return p.metadata.photos.filter((ph) => { try { return !p.files[ph.id] || !new File(p.files[ph.id]).exists; } catch { return true; } }).length;
}

/** Retry everything, stuck ones included, and say what happened. */
export async function retryAll() {
  const r = await flush({ includeStuck: true });
  toast(r.remaining === 0 ? "All uploaded" : `${r.remaining} still waiting${r.lastError ? ` · ${r.lastError}` : ""}`, r.remaining === 0 ? "ok" : "neutral");
}

/**
 * The upload queue: stuck shots first (with the server's error, Retry and Discard), then the
 * ones waiting, oldest first, then what was uploaded in the last 7 days (with the time). Reached
 * from the header sync button, the Setup status card, Setup → Offline and a long-press on the
 * Shoot Uploads button.
 */
export function Uploads() {
  const s = useStyles();
  const { c } = useTheme();
  const app = useApp();
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const queue = store.loadPending();
  const stuck = queue.filter((p) => p.stuck);
  const waiting = queue.filter((p) => !p.stuck);
  const sections = [
    ...(stuck.length ? [{ key: "stuck", title: `Stuck · ${stuck.length}`, data: stuck }] : []),
    ...(waiting.length ? [{ key: "waiting", title: "Uploading · waiting", data: waiting }] : []),
  ];
  const locationName = (id: string | null) => (id ? app.locations.find((l) => l.id === id)?.name ?? null : null);
  const history = store.loadHistory();
  const projectName = (id: string) => app.projects.find((p) => p.id === id)?.name ?? null;
  const paused = isOfflineMode();

  const run = async () => { setBusy(true); try { await retryAll(); } finally { setBusy(false); } };
  const discard = async (p: PendingUpload) => {
    const ok = await confirm({ title: "Discard this shot?", body: `Deletes the ${photoWord(p.metadata.photos.length)} queued on the phone. This can't be undone.`, confirmLabel: "Discard", danger: true });
    if (ok === true) { discardPending(p.metadata.id); toast("Discarded", "neutral"); }
  };

  return (
    <PushScreen title="Uploads" sub={queue.length ? `${queue.length} on this phone` : "Nothing waiting"} scroll={false}
      offlineMeta="Uploads resume when the server is reachable again."
      footer={queue.length ? <Button style={{ flex: 1 }} icon="refresh" label={paused ? "Offline mode is on" : sync.online ? `Retry all ${queue.length} now` : "Retry when online"} onPress={() => void run()} busy={busy || sync.state === "uploading"} disabled={!sync.online || paused} /> : undefined}>
      <SectionList
        sections={sections}
        keyExtractor={(p) => p.metadata.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        renderSectionHeader={({ section }) => (
          <View style={s.sectionHead}><SectionLabel color={section.key === "stuck" ? c.danger : undefined}>{section.title}</SectionLabel></View>
        )}
        ListEmptyComponent={
          <Empty icon="cloud-check-outline" title="All on the server" body="Nothing waiting on this phone. Every shot you took is uploaded." />
        }
        ListFooterComponent={history.length ? (
          <View>
            <View style={s.sectionHead}><SectionLabel>Uploaded · last 7 days · {history.length}</SectionLabel></View>
            {history.map((h) => (
              <View key={h.id} style={s.done}>
                <Icon name="cloud-check-outline" color={c.ok} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={s.title} numberOfLines={1}>{h.name || "Untitled shot"}</Text>
                  <Text style={s.meta} numberOfLines={1}>{[photoWord(h.photos), projectName(h.projectId), `taken ${hhmm(h.capturedAt)}`].filter(Boolean).join(" · ")}</Text>
                </View>
                <Text style={s.when}>{shortTime(h.uploadedAt)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        renderItem={({ item }) => (
          <UploadRow entry={item} settings={app.settings} location={locationName(item.metadata.location_id)} uploading={sync.progress?.shotId === item.metadata.id ? sync.progress : null}
            onRetry={() => void run()} onDiscard={() => void discard(item)} retryDisabled={!sync.online || busy} />
        )}
      />
    </PushScreen>
  );
}

function UploadRow({ entry, settings, location, uploading, onRetry, onDiscard, retryDisabled }: { entry: PendingUpload; settings: ViewSettings; location: string | null; uploading: { done: number; total: number } | null; onRetry: () => void; onDiscard: () => void; retryDisabled: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  const m = entry.metadata;
  const first = m.photos[0];
  const uri = first ? entry.files[first.id] : undefined;
  const fr = first?.framing?.frame as { width_fraction?: number; height_fraction?: number } | undefined;
  const frame = fr?.width_fraction && fr.height_fraction ? { width: fr.width_fraction, height: fr.height_fraction } : null;
  const missing = missingCount(entry);
  const state = uploading ? "uploading" : entry.stuck ? "stuck" : missing ? "missing" : "pending";
  const line = {
    uploading: { icon: "", color: c.accent, text: `Uploading ${Math.min(uploading?.done ?? 0, m.photos.length)} of ${photoWord(m.photos.length)}` },
    stuck: { icon: "alert-circle", color: c.danger, text: `Stuck after ${entry.attempts} attempts` },
    missing: { icon: "file-alert-outline", color: c.warnInk, text: `${missing} photo file${missing === 1 ? "" : "s"} missing · the rest uploads` },
    pending: { icon: "clock-outline", color: c.warnInk, text: entry.attempts ? `Waiting · ${entry.attempts} failed attempt${entry.attempts === 1 ? "" : "s"}` : "Waiting" },
  }[state];
  return (
    <View style={s.row}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={s.thumb}>
          {uri && first ? <FramedImage source={{ uri }} aspect={first.width / first.height} frame={frame} width={72} settings={settings} mode="fit" /> : <Icon name="image-off-outline" color={c.textDim} />}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={s.title} numberOfLines={1}>{m.name || "Untitled shot"}</Text>
          <Text style={s.meta} numberOfLines={1}>{[photoWord(m.photos.length), location, first ? hhmm(first.timestamp) : null].filter(Boolean).join(" · ")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            {state === "uploading" ? <ActivityIndicator size="small" color={line.color} /> : <Icon name={line.icon} size={16} color={line.color} />}
            <Text style={[s.state, { color: line.color }]}>{line.text}</Text>
          </View>
        </View>
      </View>
      {entry.stuck && (
        <>
          <Text style={s.error}>{entry.lastError ?? "The server rejected this shot."} Kept on the phone.</Text>
          <SideBySide>
            <Button style={{ flex: 1 }} kind="secondary" icon="refresh" label="Retry" onPress={onRetry} disabled={retryDisabled} />
            <Button style={{ flex: 1 }} kind="danger" icon="delete-outline" label="Discard" onPress={onDiscard} />
          </SideBySide>
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  sectionHead: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  row: { gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  thumb: { width: 72, height: 54, borderRadius: 6, overflow: "hidden", backgroundColor: FIXED.photoBg, alignItems: "center", justifyContent: "center" },
  title: { ...type("body", "bold"), color: c.text },
  meta: { ...type("small"), color: c.textDim, ...num },
  state: { ...type("small", "bold"), ...num },
  done: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  when: { ...type("small", "bold"), color: c.text, ...num },
  error: { ...type("small"), color: c.text, padding: 10, borderRadius: RADIUS.xs + 3, backgroundColor: c.dangerTint, ...num },
}));
