# Fielder

A personal tool for film location scouting and shoot planning. The phone becomes a viewfinder for your cinema rig: pick the camera, speedbooster and lens, see the real frame over the live image, and capture reference photos with GPS and framing data. A private web app, the Studio, organises them by project, and plans shooting days against daylight and the weather forecast.

Documentation for developers and AI agents lives in [`docs/`](docs/README.md); start with [`CLAUDE.md`](CLAUDE.md).

## Features

- **Rig viewfinder**: camera body/format or custom sensor, speedbooster, lens range. The true frame is drawn over the phone preview, with mask/frame/fit views and a human-eye reference frame.
- **Capture**: flashlight, sequence mode (a set of photos as one shot), optional direct upload without tagging, high-accuracy GPS, an offline upload queue that never loses a shot.
- **Projects**: every shot belongs to a project; both apps remember which one you are working on; the Studio can browse all projects at once.
- **Review and tagging** on phone and web: arrow-key navigation, in-place editing, type-to-search fields, light phases (dawn/day/dusk/night) plus artificial light, INT/EXT, weather, locations.
- **Extra fields**: your own fields as JSON (nested groups, dependent selects), writable by an AI, chosen per project.
- **Position correction**: drag the pin when GPS was off, for one photo or a whole sequence.
- **Rig explorer**: frame an existing photo with other rigs and lenses, side by side.
- **Filters and saved views**, map, gallery and list with bulk delete.
- **Shooting schedule**: plan days per project, add shots per location, see daylight phases, sunrise/sunset, the hourly forecast and when each shot's light is available.
- **Day mode** on the phone: step through the day's shots on set, and keep a day offline with all its photos.
- **Debug log** on the phone to share with an AI agent when something goes wrong.

Runs on Cloudflare (Workers, D1, R2; Access for the admin plane); the phone app is built with Expo.

## Licence

Fielder is source-available under the [Elastic License 2.0](LICENSE) (SPDX `Elastic-2.0`). In plain words: you may use, copy, modify and self-host it, for yourself or your own crew and company. You may not offer it to others as a hosted or managed service, and you may not remove the licence and copyright notices. This is not an OSI-approved open-source licence. The LICENSE file is the binding text.
