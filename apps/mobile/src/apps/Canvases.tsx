import { useEffect, useState } from "react";
import { FlatList, useWindowDimensions, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { emptyCanvas } from "@openclapper/model";
import { canCall, putFile } from "../api";
import { loadLibrary, useCanvases } from "../media/library";
import { useProject } from "../projects";
import { useBack } from "../shell/back";
import { onOpen } from "../shell/nav";
import { Empty, Header, Screen, toast } from "../ui";
import { CanvasWeb } from "./CanvasView";
import { CanvasTile } from "./Media";
import { registerApp } from "./registry";

/**
 * Canvas as a tab (docs/rewrite/ux-5-phone.md, best on a tablet): the project's canvases, and the
 * Studio's editor in a web view to draw on one (docs/features/canvas.md). A new canvas needs a
 * connection: it is made on the server and opened at once.
 */
function Canvases({ active }: { active: boolean }) {
  const project = useProject();
  const canvases = useCanvases();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState<string | null>(null);
  const cols = Math.max(2, Math.floor(width / 200));
  useEffect(() => { if (active) void loadLibrary(); }, [active, project?.id]);
  useEffect(() => onOpen("canvas", setOpen), []);
  useBack(open ? () => setOpen(null) : null, active);
  const editing = canvases.find((c) => c.id === open);
  if (open) return <CanvasWeb id={open} name={editing?.name ?? "Canvas"} onClose={() => setOpen(null)} />;
  const make = async () => {
    if (!project || !canCall()) { toast("A new canvas needs a connection", "danger"); return; }
    try { const id = randomUUID(); await putFile(id, { type: "canvas", project_id: project.id, body: emptyCanvas() as unknown as Record<string, unknown> }); await loadLibrary(); setOpen(id); }
    catch (e) { toast(`No canvas: ${(e as Error).message}`, "danger"); }
  };
  return (
    <Screen scroll={false} header={<Header title="Canvas" sub={project?.name} actions={[{ icon: "plus", label: "New canvas", onPress: () => void make() }]} />}>
      <FlatList key={cols} data={canvases} numColumns={cols} keyExtractor={(c) => c.id} contentContainerStyle={{ paddingBottom: 24 }}
        columnWrapperStyle={{ gap: 2, paddingHorizontal: 2 }} ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
        ListEmptyComponent={<Empty icon="brush" title="No canvases yet" body="Make one with the plus: a drawing, a floor plan, a photo to frame. The Studio makes them too, from a photo." />}
        renderItem={({ item }) => <View style={{ flex: 1 / cols, aspectRatio: 4 / 3 }}><CanvasTile v={item} onPress={() => setOpen(item.id)} /></View>} />
    </Screen>
  );
}

registerApp({ id: "canvas", label: "Canvas", icon: "brush", needsProject: true, Screen: Canvases });
