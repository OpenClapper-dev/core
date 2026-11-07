import { appKeyAdd, bindTargets, compositionDataGet, modelAppBind, OP, parseComposition, statusOf, type Composition, type ModelId } from "./access.ts";
import type { MeshSession } from "./session.ts";

/** AppKey Add answers 0x06 when the light already has this key (a repeated configuration). */
const KEY_ALREADY_STORED = 0x06;

export interface ConfigureResult { composition: Composition; boundModels: number; failedModels: { element: number; model: ModelId; status: number }[] }

/**
 * Sets a freshly provisioned light up (#212): read what it is made of, give it the AppKey, bind
 * the AppKey to every model but the configuration ones. Everything with the light's device key.
 * Safe to repeat: a light that already has the key or the bindings answers success again.
 */
export async function configureNode(
  s: MeshSession,
  node: { unicast: number; devKey: Uint8Array },
  app: { netKeyIndex: number; appKeyIndex: number; appKey: Uint8Array },
  onProgress?: (done: number, total: number) => void,
): Promise<ConfigureResult> {
  const key = { kind: "device" as const, key: node.devKey };
  const from = (op: number) => (r: { src: number; access: { opcode: number } }) => r.src === node.unicast && r.access.opcode === op;

  const comp = await s.request({ dst: node.unicast, access: compositionDataGet(0), key }, from(OP.COMPOSITION_DATA_STATUS));
  const composition = parseComposition(comp.access.params.subarray(1));
  if (!composition) throw new Error("the light's composition data is unreadable");
  const targets = bindTargets(composition, node.unicast);
  const total = targets.length + 1;
  onProgress?.(0, total);

  const added = statusOf((await s.request({ dst: node.unicast, access: appKeyAdd(app.netKeyIndex, app.appKeyIndex, app.appKey), key }, from(OP.APPKEY_STATUS))).access);
  if (added !== 0 && added !== KEY_ALREADY_STORED) throw new Error(`the light refused the application key (status ${added})`);
  onProgress?.(1, total);

  const failedModels: ConfigureResult["failedModels"] = [];
  let boundModels = 0;
  for (const [i, t] of targets.entries()) {
    const st = statusOf((await s.request({ dst: node.unicast, access: modelAppBind(t.element, app.appKeyIndex, t.model), key }, from(OP.MODEL_APP_STATUS))).access);
    if (st === 0) boundModels++; else failedModels.push({ ...t, status: st ?? -1 });
    onProgress?.(i + 2, total);
  }
  if (!boundModels) throw new Error("the light bound the application key to none of its models");
  return { composition, boundModels, failedModels };
}
