import { useEffect, useState } from "preact/hooks";
import { get } from "./api";

/** The members of a workspace by id, to name who made a file. Fetched once per workspace and page load. */
const cache = new Map<string, Promise<Map<string, string>>>();

function members(workspaceId: string): Promise<Map<string, string>> {
  let p = cache.get(workspaceId);
  if (!p) {
    p = get<{ members: { user_id: string; email: string; name: string | null }[] }>(`/api/workspaces/${workspaceId}/members`)
      .then((r) => new Map(r.members.map((m) => [m.user_id, m.name ?? m.email])), () => new Map());
    cache.set(workspaceId, p);
  }
  return p;
}

export function usePeople(workspaceId: string | undefined): Map<string, string> {
  const [m, setM] = useState<Map<string, string>>(new Map());
  useEffect(() => { let on = true; if (workspaceId) void members(workspaceId).then((x) => { if (on) setM(x); }); return () => { on = false; }; }, [workspaceId]);
  return m;
}
