# Muse Disaster Mission

A virtual supply-delivery coordination prototype using a public map of Japan, simulated drones and app-generated obstacles. It is not a rescue decision system and cannot control real aircraft.

The project code is offered under the MIT License in `LICENSE`. Third-party assets, data and dependencies have separate terms; see `ASSET-PROVENANCE.md` and `THIRD-PARTY-INVENTORY.md` for attribution and outstanding checks.

The real-map view uses public facilities, map imagery and 3D building models where available. In the 100-drone workflow, the application collects virtual fleet status, shares sample checks, asks Muse Spark for a proposed candidate or no candidate, and checks its response before simulated movement. Voice Transcribe supplies editable request text. Same-model roles do not imply one AI per drone. Records are stored on the local browser. Actual flooding, wires, facility opening, acceptance and flight safety are not established. Individual results and limitations are listed in `VERIFICATION.md`. The older direct `/api/map-plan` interface accepts requests without inspection evidence and, in that mode, only accepts A or B; it must not be used as a safety decision.

The data-pilot interface can show public historical imagery and retrieve Japanese Meteorological Agency observations and flood bulletins when available. It identifies the source, time and unknowns; optional automatic retrieval is off by default. User-entered reports are unverified. The app does not infer a facility's current flood level or aircraft safety from historical images or forecast zones.

## Run locally

Install Node.js 22 or later. In this folder run `npm ci`, then `npm start`, and open `http://127.0.0.1:4385/`. Internet access is needed for public map and other source data, which can fail or be unavailable. Use the displayed `127.0.0.1` address: selected endpoints require that exact local origin. The default server does not enable the Meta API. `npm test` runs automated tests; it does not prove live API or real-world performance.

For an optional live Meta connection on Windows, start `start-live.cmd` in an interactive terminal and enter a Meta Model API key into its prompt; do not paste a key into this file, code, logs, screenshots or a public repository. Check credit and billing conditions first. A configured connection indicator does not establish that Meta is reachable or that a key works. Live requests can send audio or map imagery and computed evidence to Meta; the application displays notices. Synthetic speech output is provided separately by the browser, not Voice Transcribe.

## Developed for the hackathon

The locally developed prototype includes the virtual fleet, map workflow, route checks, shared incident information, candidate validation and result history. Third-party libraries, map imagery, city models and assets are not original contributions. This repository excludes local history, recordings and keys by selection. The evidence directory contains only one published ground photograph and a test fixture. This prototype has not received a comprehensive security review.

## Third-party ground photograph

The historical ground photograph `evidence/nied-20150911-112705-original.jpg` is by the National Research Institute for Earth Science and Disaster Resilience (NIED), [source](https://ecom-plat.jp/nied-cr/index.php?gid=10132), [CC BY 2.1 Japan](https://creativecommons.org/licenses/by/2.1/jp/). The original photograph is included without modification; its clock and location may be inaccurate.

The source project identifies the Poly Haven materials as [White Plaster 02](https://polyhaven.com/a/white_plaster_02), [Asphalt 02](https://polyhaven.com/a/asphalt_02), [Modular Urban Apartments Facade](https://polyhaven.com/a/modular_urban_apartments_facade) and [Overcast Soil (Pure Sky)](https://polyhaven.com/a/overcast_soil_puresky). [Poly Haven licenses its assets as CC0](https://polyhaven.com/license); the mapping of each local file to its original download has not been independently hash-verified. The representative drone model is from [amvlab/aircraft-models](https://github.com/amvlab/aircraft-models), CC BY 4.0, as recorded in `ASSET-PROVENANCE.md`.

## Asset and data limitations

Individual map dataset terms and whether imagery may be transmitted to a model require checking for each source and use. Do not include local secrets or user recordings. The opening image is an original fictional city generated with OpenAI image generation on 2026-11-04; it is illustrative and does not show an actual event.
