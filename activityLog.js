// Rolling activity log — bans, grants, cosmetics changes, webhook/API errors,
// and (if you wire PlayFab purchase webhooks in later) economy events.
//
// In-memory, capped at MAX_ENTRIES so it can't grow forever. Resets on
// redeploy, same tradeoff as statsStore.js — fine for a mod tool, swap for
// a real store later if you want history to survive restarts.

const MAX_ENTRIES = 300;
const log = [];

let nextId = 1;

// type: "ban" | "unban" | "grant-currency" | "grant-cosmetic" | "revoke-cosmetic"
//       | "error" | "purchase" | "login"
export function record(type, { modId, playFabId, username, detail } = {}) {
  const entry = {
    id: nextId++,
    type,
    modId: modId || null,
    playFabId: playFabId || null,
    username: username || null,
    detail: detail || null,
    at: Date.now(),
  };
  log.unshift(entry); // newest first
  if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
  return entry;
}

export function list(limit = 100) {
  return log.slice(0, limit);
}
