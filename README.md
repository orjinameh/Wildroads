# Wildroads

A community-run road map built from phone sensors, with AI road and traffic reports written through
[Otari](https://github.com/mozilla-ai/otari) (Mozilla.ai's open-source LLM gateway).
Built for Mozilla's Developers Wilding hackathon.

> Drivers shouldn't touch their phones. Wildroads lets the phone feel the road for them, and the
> community's AI gateway turns what it feels into reports a road agency can act on.

Prior art: MIT's Pothole Patrol and Boston's Street Bump measured roads with phones. What this adds is
privacy-first on-device processing, repeat-trip confirmation, a traffic layer from the same trips, and AI reports
whose spend is capped per community group and per member by Otari.

## How it works

1. **Phone (browser):** reads the real accelerometer and GPS. Raw data never leaves the phone.
   It removes gravity, takes vertical vibration, cuts the trip into 25 m segments, and computes a
   speed-normalised **relative roughness index (RRI)** per segment. The first and last 200 m of every
   trip are dropped so origin and destination are never stored.
2. **Upload:** only segment summaries (location, RRI, speed). The server reduces location to a ~22 m grid
   cell and stores no timestamps beyond a UTC day and no identity. Time of day is kept only as one of four
   bands (night, morning, midday, evening). Segments too slow for roughness (crawling traffic, 2-9 km/h)
   are kept as speed readings only; they power the Traffic layer.
3. **Map:** a Roughness layer and a Traffic layer (speed by time of day). A cell measured on 2+ independent
   trips is "confirmed". Colours are relative to the data on screen.
4. **Report:** two open-weight models work through Otari. The **analyst** runs code with Otari's
   `otari_code_execution` tool (and `otari_web_search` to find the responsible road agency) and returns
   numbers as JSON. The **writer** turns only those numbers into a plain-language report. Each community
   group has its own Otari key, kept on the server, so Otari enforces that group's budget; a member's own
   spending ceiling applies on top.

RRI is **relative**. It is not IRI and is not calibrated across phones or vehicles. Use one reference
phone and mount for comparisons, and judge quality by repeat-pass agreement.

### Otari features used

Multiple models in distinct roles, code execution, web search, routing policies with backups,
budgets and spending limits (one per community group key), and per-user budgets (a member's own ceiling).
See [SUBMISSION.md](SUBMISSION.md) and [FEEDBACK.md](FEEDBACK.md).

## Set up

You need: a MongoDB Atlas cluster, an [otari.ai](https://otari.ai) workspace, and Vercel (or any Node host).

1. **Atlas:** create a free cluster and a database user. Under Network Access allow `0.0.0.0/0`, because
   Vercel functions have no fixed IP addresses, and use a strong password. Copy the connection string.
2. **Otari (hosted):** in the dashboard, enable two open-weight models, create routing policies with a backup
   model, create one API key per community group with its own budget, and (optional) give a member their own
   spending ceiling.
3. **Vercel:** import the repository, set **Root Directory** to `app`, and add the variables from
   [`.env.example`](.env.example): `MONGODB_URI`, `OTARI_BASE_URL`, `OTARI_MODEL`, `OTARI_WRITER_MODEL`,
   `OTARI_KEYS` (a JSON map of group name to that group's key; never sent to the browser) and optionally `MONGODB_DB`.
4. Open the Vercel URL on your phone. It is HTTPS, so motion sensors and GPS work.

**Base URL:** the hosted API lives under `/api/v1` on the host for your key's region, for example
`https://eu.api.otari.ai/api/v1`.

### Run locally

```bash
cd app && npm install && npm run dev
```

Without `MONGODB_URI` the app stores data in a local SQLite file (`app/data`, Node >= 22.18). For the report,
set `OTARI_BASE_URL`, `OTARI_MODEL`, `OTARI_WRITER_MODEL` and `OTARI_KEYS` in your shell.

### Testing on a phone

Motion sensors and GPS need **HTTPS**. Use the deployed URL, or in GitHub Codespaces forward port 3000, set
its visibility to Public while testing, and open the forwarded `https://...` URL on the phone. The app has no
login, so set the port back to Private afterwards. iPhone asks for Motion & Orientation permission on the first tap.

### Tests and checks

- `cd app && npm test` runs the signal-processing tests (known-amplitude sine waves through the filter and
  segmenter). They are maths checks; the app itself never generates or simulates signals.
- `OTARI_BASE_URL=... OTARI_KEY=... OTARI_MODEL=... bash scripts/otari-smoke.sh` checks the gateway without any road
  data: models list, a chat call, the code-execution tool. A key with a tiny budget shows Otari's refusal.
- On a phone, open `/record`, enable sensors and run the 12 s baseline. It reads the real accelerometer and
  needs no GPS lock, so it works indoors and shows the sensor rate and noise floor.
- A real trip needs movement of at least ~9 km/h for roughness. A bicycle, motorbike, tricycle, bus or car
  works; walking does not. Record the same route at least 3 times so cells can be confirmed.

## Status and known limits

- Checked: the segment engine tests (11), `next build`, and the Otari calls through hosted otari.ai (model list,
  routing policy, code execution, web search, a budget refusal).
- Not yet checked with real trips: on-phone recording, upload, and the AI report on real data.
- Cells are a fixed ~22 m grid, so a pass can split across two neighbouring cells. Map-matching to
  OpenStreetMap ways would fix this.
- Speed readings from one trip cannot tell congestion from a red light or a parked car. The Traffic layer only
  covers roads our own users drove.
- The upload endpoint has no authentication or rate limiting. Fine for a demo, not for production.
- Hosted Otari has no usage API for normal keys, so spend is shown in the Otari dashboard, not in the app.
- Basemap tiles come from CARTO with an OpenStreetMap fallback; use your own tile source for real traffic.

## Next

1. Calibrate against a reference road survey in a pilot, so the index means the same thing across phones.
2. Offer aggregated, consented road-condition and traffic data to road agencies and fleets.
3. Reward verified contributions (cells confirmed by independent trips) from grant or data revenue, with
   the community setting the budget through Otari.
