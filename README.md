# moddash backend

The API that sits between `projxander.github.io/moddash` and PlayFab. Holds
the PlayFab secret key and does all privileged actions — the frontend never
touches PlayFab or the secret key directly.

## Setup

```bash
npm install
cp .env.example .env
# fill in .env
npm start
```

## Deploy

Same pattern as BearLoGTBot — push this to a repo and deploy on Render as a
Web Service. Set the `.env` values as Render environment variables (never
commit `.env`). Note the resulting URL (e.g. `https://moddash-api.onrender.com`)
— that's what the frontend's `API_BASE` will point to.

## Things to set up in PlayFab before this works

1. **Segments** (Game Manager > Players > Segments): create `All Players`
   and `Banned Players` segments — `getSegmentCount` reads these for the
   stats endpoint. Adjust the segment names in `server.js` if you name them
   differently.
2. **ShinyRocks currency code**: Economy > Currencies, put the code in
   `SHINYROCKS_CURRENCY_CODE`.
3. **Mod allowlist**: same PlayFab IDs you're using for the in-game mod
   panel allowlist, comma-separated in `MOD_ALLOWLIST`.

## Wiring up live lobby data

Point your existing Photon room webhooks at:

```
POST https://<your-backend>/webhooks/photon
Header: x-webhook-secret: <PHOTON_WEBHOOK_SECRET>
Body: { "event": "join" | "leave" | "disconnect", "lobbyCode": "1", "playFabId": "...", "username": "..." }
```

You likely already have a CloudScript function receiving the raw Photon
webhook — just have it forward (or directly emit) this shape to the backend
instead of, or in addition to, whatever it does today.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /auth/login | — | Exchange a PlayFab SessionTicket for a dashboard token |
| GET | /stats | mod token | Total players, banned count, players online now |
| GET | /lobbies | mod token | List active lobby codes + player counts |
| GET | /lobbies/:code | mod token | Players in a specific lobby |
| POST | /players/:id/ban | mod token | Ban a player |
| POST | /players/:id/unban | mod token | Unban a player |
| POST | /players/:id/grant-shinyrocks | mod token | Grant 10,000 ShinyRocks (amount fixed server-side) |
| POST | /players/:id/cosmetics/grant | mod token | Grant a cosmetic by itemId |
| POST | /players/:id/cosmetics/revoke | mod token | Revoke a cosmetic by itemInstanceId |
| POST | /webhooks/photon | webhook secret | Internal — Photon room join/leave events |

## Notes / things you'll want to tune

- Lobby membership is stored in memory. Fine for one backend instance;
  if you scale to multiple instances later, swap `lobbyStore.js` for Redis
  with the same function signatures.
- `grantCosmetic`/`revokeCosmetic` assume PlayFab catalog items with
  instance-based inventory. If cosmetics are implemented as PlayFab
  container/bundle items or player data flags instead, those two functions
  in `playfab.js` will need to match however cosmetics are actually granted
  in your game's economy.
- CORS is locked to `ALLOWED_ORIGIN` (your GitHub Pages origin) so random
  sites can't call the mod API even with a stolen token pattern guess.
