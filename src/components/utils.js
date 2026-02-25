// Shared utilities — used by both MatchHistoryTab and ChampionMetaTab

/**
 * Estrae i dati del giocatore corrente da un match (struttura Riot API o flat OP.GG).
 * mySummonerName è "GameName#TAG", riotIdGameName non include il tag.
 */
export function resolveMe(match, myPuuid, mySummonerName) {
    const participants = match.info?.participants ?? match.participants ?? [];
    const myGameName = mySummonerName?.split("#")[0]?.toLowerCase() ?? "";
    const myFullLower = mySummonerName?.toLowerCase() ?? "";

    const me = participants.find(p =>
        p.isMe === true ||
        (myPuuid && p.puuid === myPuuid) ||
        (mySummonerName && (
            p.summonerName?.toLowerCase() === myFullLower ||
            p.riotIdGameName?.toLowerCase() === myFullLower ||
            (myGameName && p.riotIdGameName?.toLowerCase() === myGameName) ||
            (myGameName && p.summonerName?.toLowerCase() === myGameName)
        ))
    ) ?? participants[0];

    if (!me) return match;
    return {
        ...me,
        gameDuration: match.info?.gameDuration ?? match.gameDuration,
        gameCreation: match.info?.gameCreation ?? match.gameCreation,
    };
}

/** Inizio Season 2026 in ms (8 gennaio 2026 00:00:00 UTC) */
export const SEASON_2026_START_MS = 1736294400000;

// ── champion.json DDragon — singleton fetch condiviso tra tutti i tab ─────────
// Una sola HTTP request per tutta la sessione app, indipendentemente da quanti
// componenti chiamano getChampionMap().
let _champMapPromise = null;

/**
 * Ritorna una Promise<{byKey, byId}> risolta una sola volta per sessione.
 *   byKey: { "157": "Yasuo", ... }  — chiave numerica come stringa (masteries)
 *   byId:  { 157: "Yasuo", ... }    — chiave numerica come intero  (live game)
 */
export function getChampionMap() {
    if (!_champMapPromise) {
        const PATCH_VAL = "16.4.1";
        _champMapPromise = fetch(
            `https://ddragon.leagueoflegends.com/cdn/${PATCH_VAL}/data/en_US/champion.json`
        )
            .then(r => r.json())
            .then(json => {
                const byKey = {};
                const byId = {};
                if (json?.data) {
                    for (const [name, info] of Object.entries(json.data)) {
                        byKey[String(info.key)] = name;
                        byId[parseInt(info.key)] = name;
                    }
                }
                return { byKey, byId };
            })
            .catch(() => ({ byKey: {}, byId: {} }));
    }
    return _champMapPromise;
}