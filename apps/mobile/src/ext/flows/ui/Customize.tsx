import { Text, View } from "react-native";
import { CATALOGUE, modelName, modelOf } from "@openclapper/ext-hardware";
import { KEYFRAME_FIELDS, LIGHT_PARAMS, modelParams, NO_HIDES, PARAM_LABELS, type KeyframeField, type LightParam, type PanelHides } from "@openclapper/ext-flows";
import { setPrefs, usePrefs } from "../../../prefs";
import { Hint, makeStyles, Toggle, type } from "../../../ui";

const FIELD_LABELS: Record<KeyframeField, string> = { at: "At (time)", marginBefore: "Margin before", marginAfter: "Margin after", ...PARAM_LABELS };

/** What a keyframe sheet of a track of this model leaves out, by the account's preferences (#426). */
export function usePanelHides(): (model: string) => PanelHides {
  const p = usePrefs();
  // Stored as plain ids (core code knows no extension types); checked by the server against the same lists.
  return (model) => ({ params: (p.lightParamsHidden?.[model] ?? NO_HIDES.params) as readonly LightParam[], fields: (p.keyframeFieldsHidden ?? NO_HIDES.fields) as readonly KeyframeField[] });
}

/**
 * What the account shows of flows and lights (docs/features/flows.md, #426), the Studio's Customize: the fields of
 * every keyframe sheet, and per light model its parameters (in flows and on device cards). On: shown. Kept with the
 * account, so the Studio and every other device follow.
 */
export function Customize({ models }: { models: readonly string[] }) {
  const s = useStyles();
  const p = usePrefs();
  const lights = [...new Set([...models, ...CATALOGUE.map((m) => m.id)])].filter((id) => modelOf(id)?.type === "light" && modelParams(id).length);
  const hiddenOf = (id: string) => p.lightParamsHidden?.[id] ?? [];
  const toggleParam = (id: string, param: LightParam) => {
    const was = hiddenOf(id), next = was.includes(param) ? was.filter((x) => x !== param) : [...was, param];
    const all = { ...p.lightParamsHidden, [id]: next };
    if (!next.length) delete all[id];
    setPrefs({ lightParamsHidden: all });
  };
  const fields = p.keyframeFieldsHidden ?? [];
  const toggleField = (f: KeyframeField) => setPrefs({ keyframeFieldsHidden: fields.includes(f) ? fields.filter((x) => x !== f) : [...fields, f] });
  return (
    <View style={s.wrap}>
      <Text style={s.label}>Keyframe sheet</Text>
      <Hint>What a keyframe's sheet shows, here and in the Studio. Left out, a value keeps what it is; drag to change it.</Hint>
      {[...KEYFRAME_FIELDS, ...LIGHT_PARAMS].map((f) => <Toggle key={f} label={FIELD_LABELS[f]} value={!fields.includes(f)} onChange={() => toggleField(f)} />)}
      {lights.map((id) => (
        <View key={id} style={s.group}>
          <Text style={s.label}>{`${modelName(modelOf(id)!)}${models.includes(id) ? " · in this flow" : ""}`}</Text>
          {modelParams(id).map((param) => <Toggle key={param} label={PARAM_LABELS[param]} value={!hiddenOf(id).includes(param)} onChange={() => toggleParam(id, param)} />)}
        </View>
      ))}
      <Hint>A light's parameters left out disappear from keyframes, locks and its device cards; what plays does not change.</Hint>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { gap: 10, paddingBottom: 8 },
  group: { gap: 6, marginTop: 8 },
  label: { ...type("label", "semibold"), color: c.text },
}));
