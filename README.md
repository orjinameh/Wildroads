# Wildroads

A community-run road-roughness map built from phone sensors, with AI reports governed through
[Otari](https://github.com/mozilla-ai/otari) (Mozilla.ai's open-source LLM gateway).
Built for Mozilla's Developers Wilding hackathon.

> Drivers shouldn't touch their phones. Wildroads lets the phone feel the road for them, and the
> community's own AI gateway turns what it feels into reports a road agency can act on.

Prior art: MIT's Pothole Patrol and Boston's Street Bump measured roads with phones. What this adds is
a community-owned stack: on-device processing for privacy, repeat-trip confirmation, and AI reports
whose spend is capped and attributed per member by Otari.

## How it works

1. **Phone (browser):** reads the real accelerometer and GPS. Raw data never leaves the phone.
   It removes gravity, takes vertical vibration, cuts the trip into 25 m segments, and computes a
   speed-normalised **relative roughness index (RRI)** per segment. The first and last 200 m of every
   trip are dropped so origin and destination are never stored.
2. **Upload:** only segment summaries (location, RRI, speed, sample count). The server reduces
   location to a ~22 m grid cell, stores no timestamps beyond a UTC day and no identity.
3. **Map:** cells are coloured relative to the data on screen. A cell measured on 2+ independent trips is "confirmed".
4. **Report:** the server sends aggregated cells to a model through Otari with the `otari_code_execution`
   tool so statistics are computed in a sandbox, not guessed. The member's own Otari virtual key is used,
   so Otari enforces that key's budget and model access.
5. **Ledger:** reads Otari's usage summary grouped by the `member` tag. Nothing is computed by the app.

RRI is **relative**. It is not IRI and is not calibrated across phones or vehicles. Use one reference
phone and mount for comparisons, and judge quality by repeat-pass agreement (the map's trips/spread).

## Run it

Requirements: Node >= 22.18 (uses the built-in `node:sqlite`), Docker for Otari.

```bash
# 1. Gateway + app
cp .env.example .env        # fill OTARI_MASTER_KEY, OPENAI_API_KEY, pepper, OTARI_MODEL
docker compose up -d --build

# 2. Open the Otari dashboard at http://localhost:8000, sign in with the master key,
#    check Providers, then create a virtual key per member and set its budget.

# 3. App at http://localhost:3000
```

Without Docker, for the app only: `cd app && npm install && npm run dev`
(set `OTARI_BASE_URL`, `OTARI_MODEL`, `OTARI_MASTER_KEY` in your shell for report/ledger).

### Testing on a phone

Motion sensors and GPS need **HTTPS**. In GitHub Codespaces, forward port 3000, set its visibility to
Public while testing, and open the forwarded `https://...` URL on the phone. The app has no login, so
set the port back to Private afterwards. iPhone asks for Motion & Orientation permission on the first tap.

### Tests

`cd app && npm test` runs the signal-processing tests (known-amplitude sine waves through the filter
and segmenter). They are maths checks; the app itself never generates or simulates signals.

## Next (not built yet)

1. Calibrate against a reference road survey in a pilot, so the index means the same thing across phones.
2. Offer aggregated, consented road-condition data to road agencies and fleets.
3. Reward verified contributions (cells confirmed by independent trips) from grant or data revenue, with
   the community setting the budget through Otari.

## Testing without a vehicle

Most of the stack can be checked before you have a trip:

- `cd app && npm test` runs the signal-processing tests.
- `bash scripts/otari-smoke.sh` checks the gateway: chat call, code-execution tool, per-member tags and
  the usage ledger. It needs no road data. Use a key with a tiny budget to see Otari refuse a request.
- On a phone, open `/record`, enable sensors and run the 12 s baseline. It reads the real accelerometer
  and needs no GPS lock, so it works indoors and shows the sensor rate and noise floor.
- A real trip needs movement of at least ~9 km/h (segments below 2.5 m/s are discarded). A bicycle,
  motorbike, tricycle, bus or car works; walking does not. Record the same route at least 3 times so cells
  can be confirmed by repeat passes.

## Status and known limits

- Verified: segment engine unit tests (8/8), strict type-check of the engine and sensor modules.
- **Not yet verified end to end:** `next build`, the Otari integration (compose flags, chat call,
  usage summary shape) and on-phone recording. Run them and fix what they surface.
- Otari key creation is done in its dashboard; the key/budget REST schema was not available to read.
- Cells are a fixed ~22 m grid, so a pass can split across two neighbouring cells. Map-matching to
  OpenStreetMap ways would fix this.
- The upload endpoint has no authentication or rate limiting. Fine for a demo, not for production.
- Basemap tiles come from OpenStreetMap's public servers; use your own tile source for real traffic.
