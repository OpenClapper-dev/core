# Media: photos and collections

> **Mid-rewrite (epic [#371](https://github.com/OpenClapper-dev/core/issues/371)).** This page describes the rebuilt Studio (step B2, [#374](https://github.com/OpenClapper-dev/core/issues/374)). Photos taken on the phone come with step B3; properties, search over them and the board view with B4.

A photo is a still image that exists on its own: it belongs to one project and to nothing else ([01 · media](../rewrite/01-media.md)). Photos that belong together can be put in a **collection** ([I1](../rewrite/i1-interjection.md)). Both are files ([files](files.md)); the server side is in [the API](../api.md#photos-photosts).

## What is stored

- **Three images per photo:** the untouched original (never re-encoded), a preview of about 2048 px and a thumbnail of about 400 px. The client that adds the photo makes the preview and the thumbnail and sends them first; a photo is usable everywhere as soon as its preview is there.
- **Facts**, read-only: when it was taken (EXIF time, else the file's time), its size as shown, the **angle of view** with its source, the camera and lens as EXIF names them, where it came from (camera or import), and the raw EXIF.
- **Angle of view** (`photoAov` in `packages/fov-math`, computed by the server when the photo is added): from EXIF `FocalLengthIn35mmFilm` with the picture's own aspect ratio, else from `FocalLength` and the focal-plane resolution, else none. A photo cropped in another program keeps its EXIF, so its angle of view is then wrong without warning ([02](../rewrite/02-optics.md)).
- **A copy** of a photo (Duplicate) is a new photo that shares the stored images: it costs no storage. The images go when the last photo using them is purged from the bin.

## Importing in the Studio (`media.ts`)

- **Import** in the toolbar of Media and Files, or drop image files from the computer onto either window (onto a folder or a collection to put them there). JPEG, PNG and WebP; HEIC cannot be drawn by the browser and comes from the phone. Other files are left out, with a toast saying why.
- For each photo the browser reads the EXIF (`readExif` in `packages/model`), draws the thumbnail and the preview (upright, by the EXIF orientation), then sends what is known, the thumbnail, the preview and the original, one at a time, two photos at once.
- **Where an upload stands** shows as a badge on its tile and its row: waiting, preview sent (the original follows), stuck. A step the server refuses as wrong stays stuck; anything else (no connection, a server error) is tried again by itself, waiting longer each time. The status bar counts running and stuck uploads, with Try again and Give up. Closing the page while uploads run asks first.
- The name of a new photo is the file's name without its extension (naming patterns come with step B4).

## Media app (`apps/FilesApp.tsx` as `MediaApp`, route `#/media[/<collectionId>]`)

The one file browser, set to photos ([09 · shells](../rewrite/09-shells.md)). Everything of [Files](files.md) holds (click and tick, the properties panel, context menus, keys, panels); in addition:

- **Side bar:** All media, Collections, Not in a collection, and each collection with its count.
- **Grid** (the default) and **list**; sorted by time taken, newest first (or by name). A collection sits among the photos by its newest photo.
- **A collection is one stacked tile** that can be **scrubbed**: moving the pointer across it shows each photo in turn under a red line, with "n / count" in the corner. The switch next to the views spreads collections out into their photos.
- **The collection mark:** a photo of a collection carries its colour, drawn as a bar below (the default), a bar to the left, a dot or a thin frame (a stack's tiles behind take the colour too). How it is drawn is a preference of the account (Settings › Appearance › Media). The list shows the collection as a coloured tag.
- **Open** a collection (double-click) to see its photos; open a photo for the Photo app.
- **Collections from the menu or the panel:** Group into a collection… (the ticked photos; a name, a random colour, in the place they share), Add to collection…, Take out of the collection (back to where the collection is), Ungroup (the photos stay; the empty collection goes to the bin). Nothing of this deletes a photo.
- **A collection's panel:** its count, its order (by time, or by hand: then its photos are reordered by dragging them in its grid), and its colour: the eight colours and "+" for any other (the design system's `ColorChooser`). The colour is stored with the collection, so everyone sees the same.
- **A photo's panel:** the preview, the name, and its facts (Photo, Device; Stored and EXIF folded).
- Download the original from a photo's menu.

In **Files** photos show with their thumbnails and collections as folders you can open; dropping image files imports them into the open folder.

## Photo app (`apps/PhotoApp.tsx`, route `#/photo/<id>`)

One photo, large, on the stage, with its facts in a panel. ← and → step through the list it was opened from (else its collection, else its folder), and the window follows the photo it shows. The preview shows at once; **Full size** (`F`) loads the original. The name can be changed in the toolbar; the original can be downloaded.
