import "dotenv/config";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import * as playfab from "./playfab.js";
import * as lobbyStore from "./lobbyStore.js";

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN }));

const MOD_ALLOWLIST = new Set(
  (process.env.MOD_ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean)
);

// ---------- Auth ----------
// The dashboard's login page has the mod sign in through PlayFab client-side
// (however your game already does login), then sends the resulting
// SessionTicket here. We verify it server-side and check the allowlist,
// then hand back a short-lived dashboard token. The PlayFab secret key is
// never exposed to the browser.
app.post("/auth/login", async (req, res) => {
  try {
    const { sessionTicket } = req.body;
    if (!sessionTicket) return res.status(400).json({ error: "Missing sessionTicket" });

    const result = await playfab.authenticateSessionTicket(sessionTicket);
    const playFabId = result?.UserInfo?.PlayFabId;

    if (!playFabId || !MOD_ALLOWLIST.has(playFabId)) {
      return res.status(403).json({ error: "Not authorized as a moderator" });
    }

    const token = jwt.sign({ playFabId }, process.env.JWT_SECRET, { expiresIn: "8h" });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

function requireModAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    req.mod = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ---------- Photon webhook (internal, not for the dashboard) ----------
// Point your existing Photon room webhook config at POST /webhooks/photon.
app.post("/webhooks/photon", (req, res) => {
  if (req.headers["x-webhook-secret"] !== process.env.PHOTON_WEBHOOK_SECRET) {
    return res.status(401).end();
  }

  const { event, lobbyCode, playFabId, username } = req.body;
  if (event === "join") lobbyStore.playerJoined(lobbyCode, playFabId, username);
  else if (event === "leave") lobbyStore.playerLeft(lobbyCode, playFabId);
  else if (event === "disconnect") lobbyStore.playerLeftAnyLobby(playFabId);

  res.status(204).end();
});

// ---------- Dashboard data ----------
// Segment IDs (not names) — GetPlayersInSegment requires the actual segment ID
// from Game Manager > Players > Segments > (segment) > the ID in the URL.
const SEGMENT_ALL_PLAYERS = "3C8EF29251C15138";
const SEGMENT_BANNED_PLAYERS = "52CF4D0367AAAAB4";

app.get("/stats", requireModAuth, async (req, res) => {
  try {
    const [total, banned] = await Promise.all([
      playfab.getSegmentCount(SEGMENT_ALL_PLAYERS),
      playfab.getSegmentCount(SEGMENT_BANNED_PLAYERS),
    ]);
    res.json({
      totalPlayers: total,
      bannedPlayers: banned,
      playersOnlineNow: lobbyStore.totalPlayersOnline(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

app.get("/lobbies", requireModAuth, (req, res) => {
  res.json(lobbyStore.listLobbies());
});

app.get("/lobbies/:code", requireModAuth, (req, res) => {
  const lobby = lobbyStore.getLobby(req.params.code);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  res.json(lobby);
});

// ---------- Moderation actions ----------
app.post("/players/:id/ban", requireModAuth, async (req, res) => {
  try {
    await playfab.banPlayer(req.params.id, req.body?.reason);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ban failed" });
  }
});

app.post("/players/:id/unban", requireModAuth, async (req, res) => {
  try {
    await playfab.unbanPlayer(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unban failed" });
  }
});

// Amount is fixed server-side at 10,000 so the client can never send a
// different number — the button always means exactly one thing.
app.post("/players/:id/grant-shinyrocks", requireModAuth, async (req, res) => {
  try {
    await playfab.grantCurrency(req.params.id, process.env.SHINYROCKS_CURRENCY_CODE, 10000);
    res.json({ ok: true, granted: 10000 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Grant failed" });
  }
});

app.post("/players/:id/cosmetics/grant", requireModAuth, async (req, res) => {
  try {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: "Missing itemId" });
    await playfab.grantCosmetic(req.params.id, itemId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Grant cosmetic failed" });
  }
});

app.post("/players/:id/cosmetics/revoke", requireModAuth, async (req, res) => {
  try {
    const { itemInstanceId } = req.body;
    if (!itemInstanceId) return res.status(400).json({ error: "Missing itemInstanceId" });
    await playfab.revokeCosmetic(req.params.id, itemInstanceId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Revoke cosmetic failed" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`moddash backend listening on ${port}`));
