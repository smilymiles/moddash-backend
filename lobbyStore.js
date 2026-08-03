// Live view of "who is in which lobby right now", fed by your existing
// Photon room webhooks (the same ones already wired into CloudScript).
//
// This is in-memory, which is fine for a single backend instance. If you ever
// run more than one instance (or want it to survive restarts), swap this Map
// for Redis with the same get/set shape.

const lobbies = new Map(); // lobbyCode -> Map(playFabId -> { username, joinedAt })

export function playerJoined(lobbyCode, playFabId, username) {
  if (!lobbies.has(lobbyCode)) lobbies.set(lobbyCode, new Map());
  lobbies.get(lobbyCode).set(playFabId, { username, joinedAt: Date.now() });
}

export function playerLeft(lobbyCode, playFabId) {
  const lobby = lobbies.get(lobbyCode);
  if (!lobby) return;
  lobby.delete(playFabId);
  if (lobby.size === 0) lobbies.delete(lobbyCode);
}

// Handles a player disconnecting without a clean "left" event for their lobby.
export function playerLeftAnyLobby(playFabId) {
  for (const [code, lobby] of lobbies) {
    if (lobby.has(playFabId)) {
      lobby.delete(playFabId);
      if (lobby.size === 0) lobbies.delete(code);
    }
  }
}

export function listLobbies() {
  return [...lobbies.entries()].map(([code, players]) => ({
    code,
    playerCount: players.size,
  }));
}

export function getLobby(code) {
  const lobby = lobbies.get(code);
  if (!lobby) return null;
  return [...lobby.entries()].map(([playFabId, info]) => ({
    playFabId,
    username: info.username,
    joinedAt: info.joinedAt,
  }));
}

export function totalPlayersOnline() {
  let n = 0;
  for (const lobby of lobbies.values()) n += lobby.size;
  return n;
}
