// What the account shows of flows and lights (docs/features/flows.md, #426): a light model's parameters (in flows and
// on device cards) and the fields of every keyframe panel. Kept with the account, so the phone follows.
import { Checkbox } from "@openclapper/design";
import { CATALOGUE, modelName, modelOf } from "@openclapper/ext-hardware";
import { KEYFRAME_FIELDS, LIGHT_PARAMS, modelParams, NO_HIDES, PARAM_LABELS, type KeyframeField, type LightParam, type PanelHides } from "@openclapper/ext-flows";
import { setPrefs, usePrefs } from "../../prefs";

export const FIELD_LABELS: Record<KeyframeField, string> = { at: "At (time)", marginBefore: "Margin before", marginAfter: "Margin after", ...PARAM_LABELS };

/** What a keyframe panel of a track of this model leaves out, by the account's preferences. */
export function usePanelHides(): (model: string) => PanelHides {
  const p = usePrefs();
  // Stored as plain ids (core code knows no extension types); checked by the server against the same lists.
  return (model) => ({ params: (p.lightParamsHidden?.[model] ?? NO_HIDES.params) as readonly LightParam[], fields: (p.keyframeFieldsHidden ?? NO_HIDES.fields) as readonly KeyframeField[] });
}

/** The account's choices, as checkboxes (checked: shown); the models of this flow first, then every other light. */
export function Customize({ models }: { models: readonly string[] }) {
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
    <div className="fl-custom">
      <section>
        <strong>Keyframe panel</strong>
        <p className="fl-note">What a keyframe's panel shows, here and on the device. Left out, a value keeps what it is; drag to change it.</p>
        <div className="fl-custom__grid">
          {[...KEYFRAME_FIELDS, ...LIGHT_PARAMS].map((f) => <Checkbox key={f} checked={!fields.includes(f)} onChange={() => toggleField(f)}>{FIELD_LABELS[f]}</Checkbox>)}
        </div>
      </section>
      {lights.map((id) => (
        <section key={id}>
          <strong>{modelName(modelOf(id)!)}{models.includes(id) ? " · in this flow" : ""}</strong>
          <div className="fl-custom__grid">
            {modelParams(id).map((param) => <Checkbox key={param} checked={!hiddenOf(id).includes(param)} onChange={() => toggleParam(id, param)}>{PARAM_LABELS[param]}</Checkbox>)}
          </div>
        </section>
      ))}
      <p className="fl-note">A light's parameters left out disappear from keyframes, locks and its device cards; what plays does not change.</p>
    </div>
  );
}
