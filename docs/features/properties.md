# Properties, naming patterns, search and filters

> **Built in step B4 ([#376](https://github.com/OpenClapper-dev/core/issues/376)).** Specification: [04 shots](../rewrite/04-shots.md#properties), [07 organisation](../rewrite/07-organisation.md#properties-in-detail), [U1 files](../rewrite/ux-1-files.md). Replaces the first app's extra fields, fixed tags, saved views and Metadata board.

The metadata of a file apart from its content. One mechanism for every file type: a project keeps one **catalogue** of property definitions, each attached to the file types that carry it.

## Definitions (`packages/model/src/properties.ts`)

A definition is a file of the type `property` in the project's **Settings** folder; its name is the property's name. Its body:

| Part | Meaning |
| --- | --- |
| `field` | `text` (one line, 500 characters), `long` (20 000), `number` (with an optional `unit`), `yesno`, `choice`, `multi`, `date` (YYYY-MM-DD), `reference` (files), `position` (latitude and longitude) |
| `options` | For a choice: `{ id, label, color }` each. Values store the id, so renaming an option keeps its values. Colour 0 (none), 1–8 (the categorical colours) or #rrggbb |
| `dependsOn` | For a choice: `{ property, map }`, the options it offers per option of another single choice (line → station). Changing the parent clears a value that no longer fits |
| `targets`, `many` | For a reference: the file types it may point at (empty: any) and whether it holds several |
| `section` | A heading that groups properties in lists; visual only |
| `attached` | `[{ type, hidden? }]`: the file types that carry it; hidden keeps the values |
| `order` | Its place in the catalogue |

**Kinds**: system properties (name, type, created, updated, created by) are not definitions and only the name is editable; facts of a file type (a photo's size, time taken, angle of view, device) are read-only; definitions are the project's. The fourth kind, provided by an app or extension, is reserved.

**Changing a definition** fits its values (`refitValues`, Worker): a removed option, another field type or a reference that may now hold one file drops or trims what no longer fits, also for the choices that depend on it. **Deleting** a definition bins it with its values; restoring brings both back; purging removes them and the references they kept.

**The template**: a new project starts with Scene, Shot no., Set (a reference to sets), INT / EXT and Day / Night (shots and sets), Shot size, Angle, Movement, Support, Lens (shots), and Kind (canvases). They are ordinary definitions: change, hide or delete them.

## Values

Rows of `property_values` ([data model](../data-model.md)); set through `PUT /api/files/:id/properties` or, for many files, `POST /api/properties/set` ([api](../api.md#properties-propertiests)). Interactive edits are checked strictly by the shared rules (`valueError`). A reference value also keeps `refs` rows of kind `property`, so "where is this file used" counts it, and a copy of files (`duplicate`) points a reference at a file copied along at the copy.

## Naming patterns

Every file of a project gets a name when it is made: the type's pattern, a file of the type `naming` in Settings (`{ for, pattern, digits }`), else the default "{type} {counter}" (photos with 4 digits, others 3: "Shot 001", "Photo 0001"). Tokens: `{type}`, `{counter}` (per project and file type, `name_counters`), `{date}`, `{time}`, and on photos `{device}` (the readout's model) and `{focal}` (35 mm). A pattern with an unknown token, a photo token on another type or an unmatched brace is not used until fixed (`patternProblems`). Names stay editable and need not be unique; files that exist keep their names.

## Search

Over names and property values as text (choices by label, references by the names of the files they name), every word must match, case, accents and ß folded (`matchesSearch`, `fold`): "uber strasse" finds "Über der Straße". `GET /api/files?q=` runs it in the Worker.

## Filters (`packages/model/src/filters.ts`)

A saved query, itself a file of the type `filter`: a group of rules joined by **all** or **any**, groups nesting four deep, optionally narrowed to file types and a search text. Rules test the system properties (name, type, created, changed, folder or collection), a photo's facts (taken, horizontal angle of view) and any property (`p:<id>`), with the operators of its kind:

| Kind | Fields | Operators |
| --- | --- | --- |
| text | Name, text, long text | contains, does not contain, is, is not, is empty, is set |
| number | Number, angle of view | =, <, >, between, is empty, is set |
| date | Created, changed, taken, date | is, before, after, between, is empty, is set |
| enum | Type, single choice, yes / no | is, is not, is one of, is none of, is empty, is set |
| set, ref | Multiple choice, reference, folder | is one of, is none of, is empty, is set |
| presence | Position | is empty, is set |

Evaluated by the clients on what they loaded (`evaluate`), the same code everywhere. A rule on a deleted property matches as empty.

## In the Studio: the Project app (`apps/studio/src/apps/project/`)

**Properties** (`Properties.tsx`): the catalogue in its sections, narrowed by file type (then also listing the system properties and the type's read-only facts), with each property's field type, option count and the file types it is on. "New property" starts a text property on the type the list is narrowed to. The editor beside it (resizable) saves every change at once: name, field type (asks first when files have values), unit, what a reference points at and whether it holds several, options (colour from the design system's chooser, rename, reorder, remove with the count of files that lose the value, add), what a single choice depends on and which of its options each parent option allows, the file types it is on with hide, the section (pick or type a new one), and Delete (to the bin with its values). A project without properties offers "Add the default properties".

**Edit with AI** (`AiEdit.tsx`): three steps. Ask: the mode (add properties, or change and add) and the request; the prompt is built live from the request, the catalogue (with ids) and the answer format, and copied with one click. Paste the answer (a code fence is accepted). Review: new properties drawn as the inputs they will be; changed ones now and after, with what each change costs from the project's values ("6 files use 'Idea' and lose the value"); a proposed removal never ticked; entries that cannot be used, with the reason. Options keep their ids by label, so values survive. Nothing is saved before "Apply".

**Naming patterns** (`Naming.tsx`): a pattern and its digits per file type, the tokens drawn as boxes behind the text (red and underlined when unknown or not for this type, with the reason; such a pattern is not used), the name a file would get, and tokens put in at the caret by clicking them. Saved when the field is left. "Edit with AI" runs the same three steps with a now-and-after review of each changed pattern.

## In the Studio: the file browser (`apps/studio/src/apps/FilesApp.tsx`)

- **The properties panel** shows a file's project properties in their sections, below its facts, each with the control of its field type (`propertyEditors.tsx`): text and long text committed when left, a number with its unit, yes / no, a single choice (only what a dependent choice's parent allows), a multiple choice as coloured tags, a date as YYYY-MM-DD, a reference as the named files plus a picker of the files it may point at, a position as "latitude, longitude" or a pasted map link. Every value is saved at once.
- **Bulk edit**: with several files ticked, the panel shows the properties all of their types carry; a value set there goes to every ticked file (`POST /api/properties/set`), values that differ read "Mixed".
- **Search** looks at names and property values (choices by label, references by name), every word, case, accents and ß folded.
- **Filter** (toolbar): the builder above the list (`FilterBuilder.tsx`) with nested all/any groups and the operators of each field's kind; the list follows as it is built, across the whole project. "Save as a filter" makes a filter file (with the search text and types); a filter file opens in the browser, lists what matches now, and its changes are saved with "Save". The sidebar lists the project's filters.
- **Board** (the third view): lanes by a single-choice property the listed files carry, plus "No value"; dragging a file, or the ticked ones, to a lane sets it (a dependent choice refuses a lane its parent does not allow). Lanes as columns or rows, in S · M · L or Fit, remembered per entry. Files that do not carry the property are counted, not shown.
- **Shots** (the app): the browser set to shots, the shot list as a table with the shot properties as columns, "New shot" (named by the pattern), the board, filters in the sidebar. A shot opens in a window of its own from step B6; until then double-clicking shows its properties. Files also makes shots (New, Shot).
