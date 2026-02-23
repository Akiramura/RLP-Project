import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "./ui/card";
import { Shield, Swords, Loader2, WifiOff, Wifi, Clock } from "lucide-react";
import { PATCH } from "./constants";

// ── Costantiii ──────────────────────────────────────────────────────────────────

const TIER_COLOR = {
    IRON: "text-[#5a8ab0]",
    BRONZE: "text-amber-600",
    SILVER: "text-[#8ab0cc]",
    GOLD: "text-yellow-400",
    PLATINUM: "text-teal-400",
    EMERALD: "text-emerald-400",
    DIAMOND: "text-[#4fc3f7]",
    MASTER: "text-purple-400",
    GRANDMASTER: "text-red-400",
    CHALLENGER: "text-yellow-300",
};

const TIER_BG = {
    IRON: "bg-[#142545]/40",
    BRONZE: "bg-amber-900/30",
    SILVER: "bg-[#1e3560]/30",
    GOLD: "bg-yellow-900/30",
    PLATINUM: "bg-teal-900/30",
    EMERALD: "bg-emerald-900/30",
    DIAMOND: "bg-[#0a1e4a]/30",
    MASTER: "bg-purple-900/30",
    GRANDMASTER: "bg-red-900/30",
    CHALLENGER: "bg-yellow-900/20",
};

const TIER_SHORT = {
    IRON: "I", BRONZE: "B", SILVER: "S", GOLD: "G",
    PLATINUM: "P", EMERALD: "E", DIAMOND: "D",
    MASTER: "M", GRANDMASTER: "GM", CHALLENGER: "C",
};

const NO_DIVISION = ["MASTER", "GRANDMASTER", "CHALLENGER"];

// Normalizza nomi campione LCD → DDragon (LCD usa nomi estesi, DDragon usa chiavi)
const LCD_CHAMP_NAME_MAP = {
    "Nunu & Willump": "Nunu",
    "Wukong": "MonkeyKing",
    "Renata Glasc": "Renata",
    "Bel'Veth": "Belveth",
    "Cho'Gath": "Chogath",
    "Fiddlesticks": "FiddleSticks",
    "Kha'Zix": "Khazix",
    "Kog'Maw": "KogMaw",
    "LeBlanc": "Leblanc",
    "Rek'Sai": "RekSai",
    "Vel'Koz": "Velkoz",
    "Kai'Sa": "Kaisa",
    "Dr. Mundo": "DrMundo",
    "Tahm Kench": "TahmKench",
    "Twisted Fate": "TwistedFate",
    "Master Yi": "MasterYi",
    "Miss Fortune": "MissFortune",
    "Lee Sin": "LeeSin",
    "Jarvan IV": "JarvanIV",
    "Xin Zhao": "XinZhao",
    "Aurelion Sol": "AurelionSol",
    "K'Sante": "KSante",
};

function normalizeLcdChampName(raw) {
    if (!raw) return raw;
    if (LCD_CHAMP_NAME_MAP[raw]) return LCD_CHAMP_NAME_MAP[raw];
    // Rimuovi apostrofi, spazi, punti, &
    return raw.replace(/'/g, "").replace(/\s+/g, "").replace(/\./g, "").replace("&", "");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const champUrl = name => name ? `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${name}.png` : null;
const spellUrl = name => name ? `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/spell/${name}.png` : null;
const profileUrl = id => id ? `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/profileicon/${id}.png` : null;

function formatTimer(totalSec) {
    if (!totalSec || totalSec <= 0) return null;
    const m = Math.floor(totalSec / 60);
    const s = String(totalSec % 60).padStart(2, "0");
    return `${m}:${s}`;
}

// Calcola i secondi di gioco usando gameStartTime (epoch ms) se disponibile,
// altrimenti usa game_time (gameLength) come fallback.
function calcGameTime(data, elapsed) {
    if (data?.game_start_time && data.game_start_time > 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        const startSec = Math.floor(data.game_start_time / 1000);
        return Math.max(0, nowSec - startSec);
    }
    return (data?.game_time ?? 0) + elapsed;
}

// Hook champion id → name
function useChampIdMap() {
    const [map, setMap] = useState({});
    useEffect(() => {
        fetch(`https://ddragon.leagueoflegends.com/cdn/${PATCH}/data/en_US/champion.json`)
            .then(r => r.json())
            .then(json => {
                const m = {};
                if (json?.data) {
                    for (const [name, info] of Object.entries(json.data)) {
                        m[parseInt(info.key)] = name;
                    }
                }
                setMap(m);
            })
            .catch(() => { });
    }, []);
    return map;
}

// ── Sotto-componenti ──────────────────────────────────────────────────────────

function RankBadge({ tier, rank, lp }) {
    const t = tier?.toUpperCase() ?? "";
    if (!t || t === "NONE" || t === "") {
        return <span className="text-[#2a5070] text-xs font-medium">Unranked</span>;
    }
    const color = TIER_COLOR[t] ?? "text-[#8ab0cc]";
    const bg = TIER_BG[t] ?? "bg-[#142545]/30";
    const short = TIER_SHORT[t] ?? t;
    const showDiv = !NO_DIVISION.includes(t);
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold ${color} ${bg}`}>
            {short}{showDiv ? ` ${rank}` : ""}
            {lp > 0 && <span className="font-normal opacity-70 ml-0.5">{lp}LP</span>}
        </span>
    );
}

// Mostra le icone dei ban per un singolo team (5 slot, "-1" = nessun ban)
function BanRow({ bans, champIdMap, side }) {
    const isLeft = side === "ORDER";
    // Ordina per pick_turn
    const sorted = [...bans].sort((a, b) => a.pick_turn - b.pick_turn);
    if (sorted.length === 0) return null;

    return (
        <div className={`flex gap-1 px-1 mt-1 ${isLeft ? "justify-start" : "justify-end"}`}>
            <span className="text-[#2a5070] text-xs self-center mr-0.5">Ban:</span>
            {sorted.map((b, i) => {
                const champName = b.champion_id > 0 ? champIdMap[b.champion_id] : null;
                return champName ? (
                    <div key={i} className="relative group">
                        <img
                            src={champUrl(champName)}
                            alt={champName}
                            className="w-6 h-6 rounded object-cover grayscale opacity-70 border border-red-900/60"
                            title={champName}
                            onError={e => { e.target.style.display = "none"; }}
                        />
                        {/* Tooltip con nome */}
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 text-xs bg-[#070f1e] text-[#b8d4e8] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 border border-[#1a3558]">
                            {champName}
                        </span>
                    </div>
                ) : (
                    <div key={i} className="w-6 h-6 rounded bg-[#0d1f38] border border-[#1a3558] flex items-center justify-center">
                        <span className="text-[#2a5070] text-[8px]">?</span>
                    </div>
                );
            })}
        </div>
    );
}

function PlayerRow({ player, champIdMap, side, duoWith }) {
    const isLeft = side === "ORDER";
    // champion_name può essere già il nome DDragon (Spectator) oppure il nome esteso LCD
    const champName = normalizeLcdChampName(player.champion_name) || champIdMap[player.champion_id] || "";

    return (
        <div className={`flex items-center gap-2 py-1.5 px-2 rounded-xl transition-colors
            ${player.is_me
                ? "bg-blue-950/60 border border-[#1e6fff]/40 shadow-sm shadow-blue-900/20"
                : "hover:bg-[#0d1f38]/40"}
            ${isLeft ? "flex-row" : "flex-row-reverse"}`}
        >
            {/* Profile icon + Champion icon sovrapposti */}
            <div className="relative shrink-0 w-11 h-11">
                {/* Champion icon — più grande, in primo piano */}
                {champName ? (
                    <img
                        src={champUrl(champName)}
                        alt={champName}
                        title={champName}
                        className="w-11 h-11 rounded-lg object-cover bg-[#0d1f38] border border-[#1a3558]"
                        onError={e => {
                            e.target.style.display = "none";
                            e.target.nextElementSibling?.classList.remove("hidden");
                        }}
                    />
                ) : (
                    <div className="w-11 h-11 rounded-lg bg-[#0d1f38] border border-[#1a3558] flex items-center justify-center">
                        <Shield className="w-5 h-5 text-[#2a5070]" />
                    </div>
                )}
                {/* Profile icon piccola in basso a destra */}
                {player.profile_icon_id > 0 && (
                    <img
                        src={profileUrl(player.profile_icon_id)}
                        alt=""
                        className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full object-cover border-2 border-[#040c1a] bg-[#0d1f38]"
                        onError={e => { e.target.style.display = "none"; }}
                    />
                )}
                {/* Pallino blu per "sono io" */}
                {player.is_me && (
                    <span className="absolute -top-1 -left-1 w-3 h-3 bg-[#2278ff] rounded-full border-2 border-[#040c1a]" />
                )}
            </div>

            {/* Summoner spells */}
            <div className="flex flex-col gap-0.5 shrink-0">
                {[player.spell1, player.spell2].map((sp, i) => (
                    <img key={i}
                        src={spellUrl(sp) ?? ""}
                        alt={sp ?? ""}
                        title={sp ?? ""}
                        className="w-5 h-5 rounded object-cover bg-[#0d1f38]"
                        onError={e => { e.target.style.display = "none"; }}
                    />
                ))}
            </div>

            {/* Nome + Rank */}
            <div className={`flex-1 min-w-0 ${isLeft ? "text-left" : "text-right"}`}>
                <div className={`flex items-center gap-1 ${isLeft ? "" : "justify-end"}`}>
                    <p className={`text-sm font-semibold truncate leading-tight
                        ${player.is_me ? "text-[#7dd8ff]" : "text-[#c8e4f8]"}`}>
                        {player.summoner_name || "—"}
                    </p>
                    {duoWith && (
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-pink-900/60 text-pink-300 border border-pink-700/50 shrink-0" title={`Duo con ${duoWith}`}>
                            DUO
                        </span>
                    )}
                </div>
                <div className={`mt-0.5 ${isLeft ? "" : "flex justify-end"}`}>
                    <RankBadge tier={player.tier} rank={player.rank} lp={player.lp} />
                </div>
            </div>

            {/* Champion name piccola a destra/sinistra */}
            {champName && (
                <span className={`text-xs text-[#3a6080] shrink-0 hidden lg:block w-16 truncate
                    ${isLeft ? "text-right" : "text-left"}`}>
                    {champName}
                </span>
            )}
        </div>
    );
}

function TeamPanel({ players, bans, side, champIdMap, duoMap }) {
    const isOrder = side === "ORDER";
    const dotColor = isOrder ? "bg-[#2278ff]" : "bg-red-500";
    const label = isOrder ? "TEAM BLU" : "TEAM ROSSO";
    const color = isOrder ? "text-[#4fc3f7]" : "text-red-400";
    const border = isOrder ? "border-[#0a1e4a]/30" : "border-red-900/30";

    // Rank summary header: es. "M · M · M · M · M"
    const rankStr = players.map(p => {
        const t = (p.tier ?? "").toUpperCase();
        const s = TIER_SHORT[t];
        if (!s) return "U";
        return NO_DIVISION.includes(t) ? s : `${s}${p.rank ?? ""}`;
    }).join(" · ");

    return (
        <div className={`flex-1 min-w-0 border rounded-2xl ${border} bg-[#070f1e]/40 p-3`}>
            {/* Team header */}
            <div className="flex items-center justify-between mb-1 px-1 gap-2">
                <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                    <p className={`text-xs font-bold uppercase tracking-widest ${color}`}>{label}</p>
                </div>
                <p className="text-xs text-[#3a6080] font-mono truncate">{rankStr}</p>
            </div>

            {/* Ban row */}
            <BanRow bans={bans} champIdMap={champIdMap} side={side} />

            <div className="space-y-0.5 mt-2">
                {players.map((p, i) => (
                    <PlayerRow key={i} player={p} champIdMap={champIdMap} side={side} duoWith={duoMap?.[p.puuid]} />
                ))}
                {players.length === 0 && (
                    <p className="text-[#2a5070] text-xs text-center py-4">Nessun giocatore</p>
                )}
            </div>
        </div>
    );
}

// ── Tab principale ────────────────────────────────────────────────────────────

export function LiveGameTab({ puuidOverride = null, myPuuid = null }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // elapsed in secondi — usato solo come fallback se game_start_time non disponibile
    const [elapsed, setElapsed] = useState(0);
    // tick ogni secondo per ridisegnare il timer
    const [tick, setTick] = useState(0);
    const champIdMap = useChampIdMap();
    const pollRef = useRef(null);
    const tickRef = useRef(null);

    // Se puuidOverride è il nostro stesso puuid, usiamo get_live_game (LCD + Spectator)
    // Se è un altro giocatore, usiamo check_live_game (solo Spectator V5)
    // Se è null, usiamo get_live_game
    const isSelf = !puuidOverride || (myPuuid && puuidOverride === myPuuid);

    const fetchData = useCallback(async () => {
        try {
            const res = isSelf
                ? await invoke("get_live_game")
                : await invoke("check_live_game", { puuid: puuidOverride });
            setData(res);
            setError(null);
            if (res?.in_game) {
                setElapsed(0);
            }
        } catch (e) {
            const msg = String(e);
            setError(msg.includes("CLIENT_CLOSED") ? "client_closed" : msg);
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [puuidOverride, isSelf]);

    // Reset completo quando cambia il puuidOverride (fix pagina sporca)
    useEffect(() => {
        setData(null);
        setLoading(true);
        setError(null);
        setElapsed(0);
        clearInterval(pollRef.current);
        clearInterval(tickRef.current);

        fetchData();
        pollRef.current = setInterval(fetchData, 30000);

        return () => {
            clearInterval(pollRef.current);
            clearInterval(tickRef.current);
        };
    }, [fetchData]); // fetchData cambia quando cambia puuidOverride

    // Tick ogni secondo per aggiornare il timer
    useEffect(() => {
        clearInterval(tickRef.current);
        if (data?.in_game) {
            tickRef.current = setInterval(() => {
                setTick(t => t + 1);
                setElapsed(e => e + 1);
            }, 1000);
        }
        return () => clearInterval(tickRef.current);
    }, [data?.in_game, data?.game_id]); // si resetta se cambia partita

    // ── Loading ──────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 gap-3">
                <Loader2 className="w-7 h-7 text-[#4fc3f7] animate-spin" />
                <p className="text-[#5a8ab0]">Verifica partita in corso...</p>
            </div>
        );
    }

    // ── Client chiuso ────────────────────────────────────────────────────────
    if (error === "client_closed") {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
                <WifiOff className="w-12 h-12 text-[#1a3558]" />
                <p className="text-[#5a8ab0] text-lg font-medium">Client non rilevato</p>
                <p className="text-[#2a5070] text-sm">Apri League of Legends per usare questa funzione.</p>
            </div>
        );
    }

    // ── Non in partita ───────────────────────────────────────────────────────
    if (!data?.in_game) {
        return (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <Shield className="w-14 h-14 text-[#1a3558]" />
                <div className="text-center">
                    <p className="text-[#5a8ab0] text-lg font-medium">
                        {puuidOverride ? "Giocatore non in partita" : "Nessuna partita in corso"}
                    </p>
                    <p className="text-[#2a5070] text-sm mt-1">
                        {puuidOverride
                            ? "Questo giocatore non è attualmente in una partita live."
                            : "Entra in una partita per vedere i dati live."}
                    </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#2a5070]">
                    <Wifi className="w-3 h-3 text-green-500" />
                    <span>Controllo automatico ogni 30s</span>
                </div>
            </div>
        );
    }

    // ── In partita ───────────────────────────────────────────────────────────
    const order = data.players.filter(p => p.team === "ORDER");
    const chaos = data.players.filter(p => p.team === "CHAOS");
    const bansOrder = (data.banned_champions ?? []).filter(b => b.team === "ORDER");
    const bansChaos = (data.banned_champions ?? []).filter(b => b.team === "CHAOS");

    // Timer: preferisce game_start_time (preciso), fallback game_time + elapsed
    const gameTimeSec = calcGameTime(data, elapsed);
    void tick; // usato per forzare re-render ogni secondo

    // ── Duo detection ────────────────────────────────────────────────────────
    // Trova il giocatore "me" e cerca chi appare spesso nella sua match history
    // Per ora usa una logica semplice: due giocatori dello stesso team con stesso
    // profileIconId o segnalati come duo dall'API (non disponibile) →
    // Rilevamento da match history passata tramite prop (futuro).
    // Per il momento segniamo come potenziale duo chi ha puuid nel duo_pairs (se presenti).
    const duoMap = {}; // puuid → nome del duo partner
    const myPlayer = data.players.find(p => p.is_me);
    if (myPlayer && data.duo_pairs) {
        for (const [a, b] of (data.duo_pairs ?? [])) {
            if (a === myPlayer.puuid) {
                const partner = data.players.find(p => p.puuid === b);
                if (partner) { duoMap[b] = partner.summoner_name; duoMap[a] = myPlayer.summoner_name; }
            } else if (b === myPlayer.puuid) {
                const partner = data.players.find(p => p.puuid === a);
                if (partner) { duoMap[a] = partner.summoner_name; duoMap[b] = myPlayer.summoner_name; }
            }
        }
    }

    return (
        <div className="space-y-4">

            {/* Header */}
            <Card className="px-5 py-3.5 bg-gradient-to-r from-[#070f1e] to-[#0d1f38] border-[#1a3558]">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                        <div className="relative shrink-0">
                            <Swords className="w-5 h-5 text-red-400" />
                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                        </div>
                        <div>
                            <h2 className="text-white font-bold text-base leading-tight">Partita in corso</h2>
                            <p className="text-[#5a8ab0] text-xs">{data.queue_type}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {gameTimeSec > 0 && (
                            <div className="flex items-center gap-1.5 text-[#b8d4e8] bg-[#0d1f38] px-3 py-1.5 rounded-lg border border-[#1a3558]">
                                <Clock className="w-3.5 h-3.5 text-[#5a8ab0]" />
                                <span className="font-mono font-bold tabular-nums">
                                    {formatTimer(gameTimeSec)}
                                </span>
                            </div>
                        )}
                        <div className="flex items-center gap-1.5 text-xs text-green-400 bg-green-950/40 px-2.5 py-1.5 rounded-lg border border-green-900/40">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                            Live
                        </div>
                    </div>
                </div>
            </Card>

            {/* Teams affiancati */}
            <div className="flex gap-3 items-start">
                <TeamPanel
                    players={order}
                    bans={bansOrder}
                    side="ORDER"
                    champIdMap={champIdMap}
                    duoMap={duoMap}
                />
                <div className="flex flex-col items-center justify-center gap-1 shrink-0 pt-12">
                    <div className="w-px h-12 bg-gradient-to-b from-transparent via-slate-600 to-transparent" />
                    <span className="text-[#2a5070] font-black text-xs">VS</span>
                    <div className="w-px h-12 bg-gradient-to-b from-transparent via-slate-600 to-transparent" />
                </div>
                <TeamPanel
                    players={chaos}
                    bans={bansChaos}
                    side="CHAOS"
                    champIdMap={champIdMap}
                    duoMap={duoMap}
                />
            </div>

            <p className="text-center text-slate-700 text-xs pb-1">
                {data._source === "lcd"
                    ? "Live Client Data API (porta 2999) · aggiornamento ogni 30s"
                    : "Riot Spectator-V5 · aggiornamento ogni 30s"}
            </p>
        </div>
    );
}