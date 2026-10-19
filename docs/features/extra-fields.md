# Extra fields

Project-specific details of a shot (nearest U-Bahn station, access notes, parking…), defined by the user as JSON so an AI can write them.

## Definition format (`packages/vocab/src/fields.ts`)

```json
{ "key": "ubahn", "label": "U-Bahn", "type": "group", "fields": [
    { "key": "line", "label": "Line", "type": "select", "options": ["U1", "U4"] },
    { "key": "station", "label": "Station", "type": "select",
      "optionsBy": { "field": "line", "options": { "U1": ["Kurfürstendamm"], "U4": ["Nollendorfplatz", "Bayerischer Platz"] } } } ] }
```

- Types: `text`, `number`, `boolean`, `select`, `group`. Optional `help`.
- `select` takes either `options` (a fixed list) or `optionsBy` (options that depend on a sibling field in the same group, i.e. a cascading select). `multiple: true` stores an array.
- `group` holds `fields` and nests up to 4 levels. Keys are `[a-z][a-z0-9_]{0,39}` and unique within their level.
- `validateFieldDef` returns an error with a path, e.g. `ubahn.station: optionsBy.field "x" is not a sibling field`.
- `FIELD_PROMPT` is the text of the Studio's "Copy prompt for AI" button. It explains this format to a model.

## Values on a shot

`shots.extra` is keyed by the top-level field key; a group is a nested object: `{ "ubahn": { "line": "U4", "station": "Nollendorfplatz" } }`.

- `validateValues(defs, extra)` does a strict check: only fields of the project, right types, options that are valid for the sibling's value. It is used by `PATCH /api/shots/:id`. The bulk `PATCH /api/shots` merges its values with `patchExtra(defs, extra, patch)` (per key, groups child by child) and checks only the edited keys (`validateValues(defs, extra, path, only)`), so stale values a bulk edit leaves alone don't block it.
- Uploads only run `pruneExtra` (drop empty values and groups), so a phone with stale definitions never gets a capture rejected.
- `extraSummary(defs, extra)` gives display text ("U-Bahn › Line: U4 · …"); `extraLabel` is the fallback without definitions.
- Changing the parent select clears a dependent value that no longer fits (both editors).

## Storage and API

- Definitions belong to one project (`field_definitions.project_id`, one row per top-level field, ordered by `position`); keys are unique within the project. To reuse fields in another project, Copy all there and import them. Library › Projects lists a project's fields; Library › Fields edits and orders the active project's.
- `POST /api/fields/import` takes a project and an array: new keys are created there, its existing keys replaced, everything validated before anything is written.
- Deleting a definition keeps the stored values on shots; they are just no longer shown or edited.
- **Moving a shot** to another project keeps only the values the target's fields accept (`fitExtra`; `droppedKeys` lists the rest). The inspector names the values a move drops before Move.

## UI

- **Studio Library › Fields** (`Fields.tsx`):
  - a list with type and usage
  - "New field ▾" from templates (text, number, yes/no, select, group with a dependent select)
  - a JSON editor with line numbers; a parse error highlights its line and shows the message. Save field (⌘S) or Revert.
  - a live form preview (`ExtraEditor.tsx`, showing the last valid version while the JSON is broken)
  - Import JSON…, Copy all, Copy prompt for AI
- **Tag forms**: Studio `ExtraEditor.tsx` (combobox selects), phone `components/TagEditor.tsx` (a row per field that opens a sheet: chips up to 12 options, a search list above; groups expand in place). They render the fields of the shot's project.
- **Phone offline**: definitions and each project's `fieldIds` are cached during `flush()`. `store.fieldsForProject(projectId)` reads them.
- **Filters**: `extraFilterFields(defs)` turns every leaf into a filter field `extra.<path>` (select → enum/set, boolean → yes/no, number, text). The Shots filter panel shows them under "Extra fields" (the active project's fields).
