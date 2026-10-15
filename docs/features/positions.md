# GPS and position correction

## Acquisition (phone, `Viewfinder.tsx`)

Three **GPS modes** (Setup → Capture → GPS, `settings.gpsMode`, default High):

| Mode | Watch while Shoot is on screen | At capture |
| --- | --- | --- |
| **High** | `BestForNavigation`, every second | a watched fix younger than 15 s; otherwise wait up to 8 s for a `Highest` fix; then the last watched or last known (≤ 10 min) |
| **Low** | `Balanced`, every 5 s (less battery) | the last watched fix, else the last known position (≤ 30 min); never waits |
| **Off** | none (the location service is not started; leaving the mode removes the watch, no restart needed) | no position |

- **Sequences**: every photo after the first takes the first photo's position, in every mode, so frames never wait on GPS (`device.gps_from_first_photo`). If the first had none, later ones try the Low rule.
- **No fix at all** (High or Low): the photo is kept without a position, with a toast; it is never refused. Set one by hand later.
- The HUD chip shows the mode and accuracy ("GPS ±5 m", "GPS low ±40 m", "GPS off"). The amber warning is for no fix, or worse than ±20 m in High; Off is a choice, not a warning.
- On Android the app asks once to turn on Google Location Accuracy (`enableNetworkProviderAsync`, High and Low). Wi-Fi/cell assistance gives much faster and tighter fixes.
- Stored per photo: `lat`, `lon` (both null without a position), `gps_accuracy_m`, and in `device` the mode, altitude, heading and fix age.

## Photos without a position

- Lists show them; maps leave them out (dashboard Map lists them as "No position · not on the map"). Plan and Day centre the daylight on the shots that have one (Berlin when none has). Filter: "Has position is no".
- **Set position**: the same map as Correct, starting at another photo of the shot (else Berlin); on the phone also **Use my location** (asks the phone once, also in GPS off). Saving sets `position_corrected`.

## Manual correction

- **Dashboard** (`PositionEditor.tsx`): the shot view → stage **Position** (or the inspector’s Position → Correct). The stage becomes a map at zoom 18 with the reported accuracy circle and the original position. Drag the pin or click the map; the bar shows the coordinates and the distance moved. Save position (Enter) or Cancel (Esc).
- **Phone** (`CorrectPosition` in `screens/ShotDetails.tsx`): Shot details → Correct, or ⋯ → Correct position in History. A full-screen Leaflet map in a WebView at zoom 18 with the reported accuracy as a dashed circle; drag the pin or tap the map. The bottom bar shows "All n photos of this shot" (sequences, on by default), the live coordinates and the distance moved, and Cancel | Save position (disabled until moved). Offline it says the map needs a connection.
- For a sequence, "All n photos of this shot" moves every photo (default on).
- On the phone the correction works on queued shots too (it rewrites the queue entry, `position_corrected` goes up with the upload) and offline (kept on the phone and sent later). The map itself needs a connection.
- API: `PATCH /api/photos/:id { lat, lon, all_in_shot }`. It sets `photos.position_corrected = 1`, keeps the original `gps_accuracy_m`, and the UI shows "corrected" instead of the accuracy.

Maps use the cover photo's position for a shot (dashboard Shots › Map, `MapView.tsx`; phone Shots › Map and Show on map, `screens/Shots.tsx`, `ShotDetails.tsx`).

## Location positions and synced shots ([issue #19](https://github.com/bubulux/fielder/issues/19))

- A **location** can have a pin (`locations.lat`, `lon`). Set it in Library › Locations → Set position (`P`, or click the coordinates): a map dialog with a draggable pin, the location's shots drawn as dots at their **own** positions for orientation (amber = synced to the location, title on hover), Save position and Remove pin. Without a pin the map opens at the centre of those shots (else Berlin). The table shows the pin and how many shots are synced.
- A **shot** can take its position from its location: `shots.position_from_location`. Set it in the inspector's Position section ("Use the location's position") or for many shots at once in bulk edit (Position: Own (photo GPS) · From location). It is a reference: the photos keep their GPS, and switching back restores it. Moving the location pin moves every synced shot.
- **Spots** ([projects](projects.md)) have a pin too (Library › Locations → the Spots panel → Set position; it starts at the location's pin). A synced shot uses its spot's pin, else its location's: the API's `location_position` already is that place pin.
- `positionOf()` (both clients) uses the place's pin when the shot is synced **and** the place has one; otherwise the shot's own position. Every map, "Show on map", the Has-position filter and the daylight centre of Plan and Day go through it. A synced shot without a location, or whose location has no pin, keeps its own position.
- The phone shows synced positions but cannot change the flag or the pin. A location rename from the phone (PUT with only `name`) keeps the pin.
