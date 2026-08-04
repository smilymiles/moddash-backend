// Minimal PlayFab Admin/Server API client.
// The secret key NEVER leaves this file / this server. The frontend never sees it.

const TITLE_ID = process.env.PLAYFAB_TITLE_ID;
const SECRET_KEY = process.env.PLAYFAB_SECRET_KEY;
const BASE_URL = `https://${TITLE_ID}.playfabapi.com`;

async function pfCall(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SecretKey": SECRET_KEY,
    },
    body: JSON.stringify(body || {}),
  });

  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (parseErr) {
    throw new Error(
      `PlayFab returned non-JSON response on ${path} (status ${res.status}): ${raw.slice(0, 300)}`
    );
  }

  if (!res.ok) {
    const msg = data?.errorMessage || `PlayFab error on ${path} (HTTP ${res.status}): ${raw.slice(0, 300)}`;
    const err = new Error(msg);
    err.playfab = data;
    err.status = res.status;
    err.raw = raw;
    throw err;
  }
  return data.data;
}

// --- Auth (used by /auth/login to validate a client's session ticket) ---
export function authenticateSessionTicket(sessionTicket) {
  return pfCall("/Server/AuthenticateSessionTicket", { SessionTicket: sessionTicket });
}

// --- Stats ---
// Requires a PlayFab segment already created in Game Manager, e.g. "All Players" and "Banned Players".
export function getSegmentCount(segmentId) {
  return pfCall("/Admin/GetPlayersInSegment", { SegmentId: segmentId, MaxBatchSize: 1 })
    .then((d) => d.ProfilesInSegment);
}

// --- Player lookup ---
export function getPlayerProfile(playFabId) {
  return pfCall("/Server/GetPlayerProfile", {
    PlayFabId: playFabId,
    ProfileConstraints: { ShowDisplayName: true, ShowBannedUntil: true },
  });
}

export function getUserAccountInfo(playFabId) {
  return pfCall("/Server/GetUserAccountInfo", { PlayFabId: playFabId });
}

// --- Moderation actions ---
// Also tags the player "banned" so the "Banned Players" segment (Tag = banned)
// actually reflects who's banned — PlayFab segments have no native ban-status filter.
export async function banPlayer(playFabId, reason = "Banned via moddash") {
  const result = await pfCall("/Admin/BanUsers", {
    Bans: [{ PlayFabId: playFabId, Reason: reason, Permanent: true }],
  });
  await pfCall("/Server/AddPlayerTag", { PlayFabId: playFabId, TagName: "banned" });
  return result;
}

export async function unbanPlayer(playFabId) {
  const result = await pfCall("/Admin/RevokeAllBansForUser", { PlayFabId: playFabId });
  await pfCall("/Server/RemovePlayerTag", { PlayFabId: playFabId, TagName: "banned" });
  return result;
}

export function grantCurrency(playFabId, currencyCode, amount) {
  return pfCall("/Server/AddUserVirtualCurrency", {
    PlayFabId: playFabId,
    VirtualCurrency: currencyCode,
    Amount: amount,
  });
}

// Grants an item (cosmetic) from the DLC catalog to a player.
export function grantCosmetic(playFabId, itemId) {
  return pfCall("/Server/GrantItemsToUser", {
    PlayFabId: playFabId,
    CatalogVersion: "DLC",
    ItemIds: [itemId],
  });
}

export function revokeCosmetic(playFabId, itemInstanceId) {
  return pfCall("/Server/RevokeInventoryItem", {
    PlayFabId: playFabId,
    ItemInstanceId: itemInstanceId,
  });
}
