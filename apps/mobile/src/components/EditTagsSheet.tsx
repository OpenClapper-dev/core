import { useEffect, useState } from "react";
import { View } from "react-native";
import { pruneExtra } from "@openclapper/vocab";
import type { Shot } from "../api";
import { useApp } from "../appState";
import { editShot, isWaiting } from "../localShots";
import { ensureLocation, ensureSpot } from "../namedSync";
import { isOfflineMode } from "../net";
import { store } from "../storage";
import { Banner, Button, Sheet, SheetList, toast } from "../ui";
import { TagEditor, type TagDraft } from "./TagEditor";

const draftOf = (s: Shot): TagDraft => ({
  tags: { name: s.name, light: s.light, artificial: s.artificial, weather: s.weather, int_ext: s.int_ext, location_id: s.location_id, spot_id: s.spot_id ?? null, shot_size: s.shot_size ?? null, camera_support: s.camera_support ?? null, movement: s.movement ?? [], extra: s.extra ?? {} },
  newLocation: null,
  newSpot: null,
});

/**
 * Edit a shot's tags: the same TagEditor as after a capture, in a 92 % sheet with Save pinned.
 * Saved through editShot (server, upload queue, or kept on the phone until online); a rejection
 * keeps the sheet open with the error on top.
 */
export function EditTagsSheet({ shot, visible, onClose }: { shot: Shot; visible: boolean; onClose: () => void }) {
  const app = useApp();
  const [draft, setDraft] = useState<TagDraft>(() => draftOf(shot));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (visible) { setDraft(draftOf(shot)); setError(null); } }, [visible, shot.id]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      let tags = { ...draft.tags, name: draft.tags.name?.trim() || null, extra: pruneExtra(draft.tags.extra) };
      const nl = draft.newLocation;
      let locationOnServer = !nl;
      if (nl) {
        // Offline (or a queued shot): keep the new location on the phone; the next flush creates it first.
        let id = nl.id, synced = false;
        if (!shot.queued && !isOfflineMode()) { try { id = await ensureLocation(nl); synced = true; } catch { /* stays local */ } }
        locationOnServer = synced;
        app.setLocations([...app.locations.filter((l) => l.id !== nl.id && l.id !== id), { ...nl, id, synced }]);
        tags = { ...tags, location_id: id };
      }
      const ns = draft.newSpot;
      if (ns && tags.location_id) {
        // Its location may just have been adopted under another id (a name clash on the server).
        let id = ns.id, synced = false;
        const spotEntry = { ...ns, locationId: tags.location_id };
        if (!shot.queued && !isOfflineMode() && locationOnServer) { try { id = await ensureSpot(spotEntry); synced = true; } catch { /* stays local */ } }
        app.setSpots([...app.spots.filter((x) => x.id !== ns.id && x.id !== id), { ...spotEntry, id, synced }]);
        tags = { ...tags, spot_id: id };
      }
      const updated = await editShot(shot, tags);
      app.shots.update(updated);
      toast(updated.queued ? "Saved · uploads with the shot" : isWaiting(shot.id) ? "Saved · syncs when online" : "Saved");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <Sheet visible={visible} title="Edit details" onClose={onClose} height={0.92} leadLabel="Cancel" doneLabel={null}
      footer={<Button icon="check" label="Save" onPress={() => void save()} busy={busy} />}>
      <SheetList>
        {error && <View style={{ padding: 12 }}><Banner kind="danger" title="Not saved" meta={`${error}. Your edits are still here.`} /></View>}
        <TagEditor value={draft} onChange={setDraft} projectId={shot.project_id} locations={app.locations} spots={app.spots} countAt={app.countAt}
          fields={store.fieldsForProject(shot.project_id)} projectName={app.projects.find((p) => p.id === shot.project_id)?.name} />
      </SheetList>
    </Sheet>
  );
}
