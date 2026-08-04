import "dotenv/config";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import * as playfab from "./playfab.js";
import * as lobbyStore from "./lobbyStore.js";
import * as statsStore from "./statsStore.js";
import * as activityLog from "./activityLog.js";

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
    activityLog.record("login", { modId: playFabId });
    res.json({ token });
  } catch (err) {
    console.error(err);
    activityLog.record("error", { detail: `Login failed: ${err.message}` });
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
const seenPlayers = new Set();

app.post("/webhooks/photon", (req, res) => {
  if (req.headers["x-webhook-secret"] !== process.env.PHOTON_WEBHOOK_SECRET) {
    return res.status(401).end();
  }

  const { event, lobbyCode, playFabId, username } = req.body;
  if (event === "join") {
    lobbyStore.playerJoined(lobbyCode, playFabId, username);
    // Count each distinct player we've seen since this server started as a
    // "total player" — rough, but tracks reality without a DB.
    if (playFabId && !seenPlayers.has(playFabId)) {
      seenPlayers.add(playFabId);
      statsStore.recordNewPlayer();
    }
  } else if (event === "leave") lobbyStore.playerLeft(lobbyCode, playFabId);
  else if (event === "disconnect") lobbyStore.playerLeftAnyLobby(playFabId);

  res.status(204).end();
});

// One-time (or occasional) manual seed so counts don't start at zero —
// e.g. call this once with your real player/ban totals from wherever you
// last had them (PlayFab's Data Explorer, an old export, a rough estimate).
app.post("/stats/seed", requireModAuth, (req, res) => {
  const { totalPlayers, bannedPlayers } = req.body || {};
  statsStore.seedCounts({ totalPlayers, bannedPlayers });
  res.json(statsStore.getCounts());
});

// PlayFab CloudScript "player purchased item" / "currency granted" events can
// call this (via an HTTP action or a small relay in CloudScript) so purchases
// show up in the activity log too. Same shared-secret pattern as Photon.
app.post("/webhooks/playfab", (req, res) => {
  if (req.headers["x-webhook-secret"] !== process.env.PHOTON_WEBHOOK_SECRET) {
    return res.status(401).end();
  }
  const { playFabId, detail } = req.body || {};
  activityLog.record("purchase", { playFabId, detail });
  res.status(204).end();
});

// ---------- Dashboard data ----------
// Total/banned counts are tracked ourselves (see statsStore.js) — PlayFab's
// GetPlayersInSegment API, which used to power this, was retired 3/31/2026.
app.get("/stats", requireModAuth, async (req, res) => {
  try {
    const { totalPlayers, bannedPlayers } = statsStore.getCounts();
    res.json({
      totalPlayers,
      bannedPlayers,
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

app.get("/activity", requireModAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 300);
  res.json(activityLog.list(limit));
});

// ---------- Moderation actions ----------
app.post("/players/:id/ban", requireModAuth, async (req, res) => {
  try {
    await playfab.banPlayer(req.params.id, req.body?.reason);
    statsStore.recordBan();
    activityLog.record("ban", {
      modId: req.mod.playFabId,
      playFabId: req.params.id,
      username: req.body?.username,
      detail: req.body?.reason || "No reason given",
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    activityLog.record("error", {
      modId: req.mod?.playFabId,
      playFabId: req.params.id,
      detail: `Ban failed: ${err.message}`,
    });
    res.status(500).json({ error: "Ban failed" });
  }
});

app.post("/players/:id/unban", requireModAuth, async (req, res) => {
  try {
    await playfab.unbanPlayer(req.params.id);
    statsStore.recordUnban();
    activityLog.record("unban", {
      modId: req.mod.playFabId,
      playFabId: req.params.id,
      username: req.body?.username,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    activityLog.record("error", {
      modId: req.mod?.playFabId,
      playFabId: req.params.id,
      detail: `Unban failed: ${err.message}`,
    });
    res.status(500).json({ error: "Unban failed" });
  }
});

// Amount is fixed server-side at 10,000 so the client can never send a
// different number — the button always means exactly one thing.
app.post("/players/:id/grant-shinyrocks", requireModAuth, async (req, res) => {
  try {
    await playfab.grantCurrency(req.params.id, process.env.SHINYROCKS_CURRENCY_CODE, 10000);
    activityLog.record("grant-currency", {
      modId: req.mod.playFabId,
      playFabId: req.params.id,
      username: req.body?.username,
      detail: "10,000 Shiny Rocks",
    });
    res.json({ ok: true, granted: 10000 });
  } catch (err) {
    console.error(err);
    activityLog.record("error", {
      modId: req.mod?.playFabId,
      playFabId: req.params.id,
      detail: `Grant currency failed: ${err.message}`,
    });
    res.status(500).json({ error: "Grant failed" });
  }
});

app.post("/players/:id/cosmetics/grant", requireModAuth, async (req, res) => {
  try {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: "Missing itemId" });
    await playfab.grantCosmetic(req.params.id, itemId);
    activityLog.record("grant-cosmetic", {
      modId: req.mod.playFabId,
      playFabId: req.params.id,
      username: req.body?.username,
      detail: itemId,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    activityLog.record("error", {
      modId: req.mod?.playFabId,
      playFabId: req.params.id,
      detail: `Grant cosmetic failed: ${err.message}`,
    });
    res.status(500).json({ error: "Grant cosmetic failed" });
  }
});

app.post("/players/:id/cosmetics/revoke", requireModAuth, async (req, res) => {
  try {
    const { itemInstanceId } = req.body;
    if (!itemInstanceId) return res.status(400).json({ error: "Missing itemInstanceId" });
    await playfab.revokeCosmetic(req.params.id, itemInstanceId);
    activityLog.record("revoke-cosmetic", {
      modId: req.mod.playFabId,
      playFabId: req.params.id,
      username: req.body?.username,
      detail: itemInstanceId,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    activityLog.record("error", {
      modId: req.mod?.playFabId,
      playFabId: req.params.id,
      detail: `Revoke cosmetic failed: ${err.message}`,
    });
    res.status(500).json({ error: "Revoke cosmetic failed" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`moddash backend listening on ${port}`));
