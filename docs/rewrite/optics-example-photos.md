# Shot list: example photos for the optics preview

For the preview when an optics preset is created ([02](02-optics.md), [U2](ux-2-canvas.md)). The app draws what a preset sees as a frame on these photos, so each photo has to be wider than nearly every lens a user will enter, and its angle of view has to be known exactly. Shot by the owner.

## What every photo needs

| Requirement | Why |
| --- | --- |
| Full-frame camera with a 14 mm rectilinear lens (104° × 81°) | Every longer lens is then an exact crop of the photo. A fisheye does not work |
| Lens corrections on (distortion, vignetting), or corrected in development | The frame math assumes a straight, undistorted picture |
| Landscape orientation, the camera level (no tilt, no roll), on a tripod | A frame is drawn centred; a tilted horizon reads as an error of the app |
| The full sensor area, 3:2, not cropped afterwards | A crop changes the angle of view |
| EXIF kept: focal length and camera model | The app reads the angle of view from it, as for any photo |
| Sharp from near to far (about f/8), base ISO | Tight frames enlarge a small part of the picture |
| The highest resolution the camera has; a JPEG at full size and the raw file | A 135 mm frame uses about a tenth of the width |
| The subject in the middle of the picture | Frames start centred; what matters should be there |
| No recognisable people who have not agreed, no licence plates, no brands in the middle | The photos ship with the app |

If no 14 mm lens is at hand: any rectilinear lens of 16 mm or shorter works. The exact focal length is then written here; the app only needs to know it.

## The scenes

Four are needed, a fifth and sixth are welcome. One good frame each.

| # | Scene | What to look for |
| --- | --- | --- |
| 1 | **Interior**: a furnished room from a corner | Depth, furniture at several distances, a window or lamp. Where wide lenses are judged |
| 2 | **Street**: a street or square with buildings, looking along it | Straight verticals, a clear vanishing point, things to pick out at 50 and 85 mm |
| 3 | **Open landscape**: a wide view with a clear horizon | The horizon in the middle; something distant (a tower, a tree) for long lenses |
| 4 | **Person at a known distance**: someone standing 3 m from the camera, facing it, full figure, in the middle | The classic check of shot sizes. Measure the 3 m and write it here. The person agrees to be in the app |
| 5 | **Dusk or night** (optional): a lit street or waterfront | So the preview is not only daylight |
| 6 | **Close quarters** (optional): a car interior, a corridor, a stairwell | Where only wide lenses fit |

## To hand over

- Per scene: the full-size JPEG and the raw file, named after the scene.
- The camera and lens used, and for scene 4 the measured distance.
- Confirmation that the people shown agree and that the places may be shown.
