// Tracks total-players and banned-players counts ourselves.
//
// PlayFab's GetPlayersInSegment API (what stats used to rely on) was
// retired March 31, 2026 — replaced by an async export-based API that
// isn't a good fit for a live dashboard number. Instead we just count
// events ourselves as they happen:
//   - call recordNewPlayer() wherever a player first registers/logs in
//   - call recordBan() / recordUnban() from the ban/unban routes
//
// In-memory, resets on redeploy. Fine for a mod tool; swap for a real
// store (Redis, a JSON file, a DB row) later if you want it durable.

let totalPlayers = 0;
let bannedPlayers = 0;

export function recordNewPlayer() {
  totalPlayers += 1;
}

export function recordBan() {
  bannedPlayers += 1;
}

export function recordUnban() {
  bannedPlayers = Math.max(0, bannedPlayers - 1);
}

export function getCounts() {
  return { totalPlayers, bannedPlayers };
}

// Lets you set a starting point once (e.g. from a one-time PlayFab
// export or a rough headcount) instead of starting at zero.
export function seedCounts({ totalPlayers: t, bannedPlayers: b } = {}) {
  if (typeof t === "number") totalPlayers = t;
  if (typeof b === "number") bannedPlayers = b;
}
