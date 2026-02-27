import { Card } from "./ui/card";
import { Clock, TrendingUp, ChevronDown, ChevronUp, ShoppingCart } from "lucide-react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PATCH } from "./constants";
import { resolveMe } from "./utils";

const POSITION_ICON = {
    top: "🛡️", jungle: "🌲", mid: "✨",
    adc: "🏹", bottom: "🏹", support: "💊", utility: "💊",
};

function championIconUrl(name) {
    if (!name) return null;
    return `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${name}.png`;
}

function itemIconUrl(id) {
    if (!id || id === 0) return null;
    return `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/item/${id}.png`;
}

function spellIconUrl(id) {
    const MAP = {
        4: "SummonerFlash", 14: "SummonerDot", 12: "SummonerTeleport",
        21: "SummonerBarrier", 3: "SummonerExhaust", 6: "SummonerHaste",
        7: "SummonerHeal", 1: "SummonerBoost", 11: "SummonerSmite",
        13: "SummonerMana", 32: "SummonerSnowball",
    };
    const name = MAP[id];
    return name ? `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/spell/${name}.png` : null;
}

function formatDuration(sec) {
    if (!sec) return "—";
    return `${Math.floor(sec / 60)}m ${(sec % 60).toString().padStart(2, "0")}s`;
}

function formatDate(d) {
    if (!d) return "";
    const dt = typeof d === "number" ? new Date(d) : new Date(d);
    if (isNaN(dt)) return "";
    return dt.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

function KdaBar({ kills, deaths, assists }) {
    const kda = deaths === 0 ? "Perfect" : ((kills + assists) / deaths).toFixed(2);
    const good = kda === "Perfect" || parseFloat(kda) >= 3;
    const bad = kda !== "Perfect" && parseFloat(kda) < 2;
    return (
        <div className="w-28 shrink-0">
            <p className="text-white font-bold text-sm tabular-nums">
                {kills} / <span className="text-red-400">{deaths}</span> / {assists}
            </p>
            <p className="text-xs">
                <span className={good ? "text-yellow-400" : bad ? "text-[#5a8ab0]" : "text-[#4fc3f7]"}>{kda}</span>
                <span className="text-[#3a6080]"> KDA</span>
            </p>
        </div>
    );
}

function ItemRow({ items }) {
    return (
        <div className="flex gap-1 flex-wrap items-center">
            {Array.from({ length: 7 }, (_, i) => {
                const id = items?.[i];
                const url = itemIconUrl(id);
                return url
                    ? <img key={i} src={url} alt={`item${i}`} className="w-7 h-7 rounded object-cover bg-[#0d1f38]" onError={e => { e.target.style.display = "none"; }} />
                    : <div key={i} className="w-7 h-7 rounded bg-[#0d1f38]/60" />;
            })}
        </div>
    );
}

function SpellRow({ spells }) {
    if (!spells?.length) return null;
    return (
        <div className="flex gap-0.5 mt-0.5">
            {spells.slice(0, 2).map((id, i) => {
                const url = spellIconUrl(id);
                return url
                    ? <img key={i} src={url} alt={`sp${i}`} className="w-6 h-6 rounded object-cover bg-[#0d1f38]" onError={e => { e.target.style.display = "none"; }} />
                    : <div key={i} className="w-6 h-6 rounded bg-[#0d1f38]/60" />;
            })}
        </div>
    );
}

function TeamsPanel({ participants, myTeamId, myPuuid, mySummonerName, onPlayerClick }) {
    if (!participants?.length) return null;

    function isCurrentPlayer(p) {
        if (p.isMe === true) return true;
        if (myPuuid && p.puuid === myPuuid) return true;
        if (!mySummonerName) return false;
        const fullName = mySummonerName.toLowerCase();
        const gameName = fullName.split("#")[0];
        return (
            p.summonerName?.toLowerCase() === fullName ||
            p.riotIdGameName?.toLowerCase() === fullName ||
            p.summonerName?.toLowerCase() === gameName ||
            p.riotIdGameName?.toLowerCase() === gameName
        );
    }

    // Determina i due team: usa teamId se disponibile, altrimenti split 5/5
    const teamIds = [...new Set(participants.map(p => p.teamId).filter(id => id != null))];
    let myTeam, enemies;
    if (teamIds.length >= 2) {
        const sorted = [...teamIds].sort();
        const meParticipant = participants.find(p => isCurrentPlayer(p));
        const myId = myTeamId ?? meParticipant?.teamId ?? sorted[0];
        myTeam = participants.filter(p => p.teamId === myId);
        enemies = participants.filter(p => p.teamId !== myId);
    } else {
        myTeam = participants.slice(0, 5);
        enemies = participants.slice(5);
    }

    function PlayerRow({ p }) {
        const isMe = isCurrentPlayer(p);
        const displayName = p.riotIdGameName ?? p.summonerName ?? p.championName;
        const kda = p.deaths === 0 ? "Perf" : ((p.kills + p.assists) / p.deaths).toFixed(1);
        const clickable = !isMe && onPlayerClick && (p.riotIdGameName || p.summonerName);
        const handleClick = () => {
            if (!clickable) return;
            const name = p.riotIdGameName ?? p.summonerName;
            const tag = p.riotIdTagline || null;
            const summonerId = tag
                ? `${name}#${tag}`
                : name.includes("#") ? name : `${name}#EUW`;
            onPlayerClick(summonerId);
        };
        const playerItems = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6];
        return (
            <div
                onClick={clickable ? handleClick : undefined}
                className={`flex items-center gap-2 py-1 px-2 rounded-md transition-colors
                    ${isMe ? "bg-[#142545]/70 border border-[#244570]/50" : ""}
                    ${clickable ? "cursor-pointer hover:bg-[#142545]/70 hover:border hover:border-[#244570]/50" : "hover:bg-[#0d1f38]/50"}
                `}
            >
                <img
                    src={championIconUrl(p.championName)}
                    alt={p.championName}
                    className="w-7 h-7 rounded object-cover bg-[#0d1f38] shrink-0"
                    onError={e => { e.target.style.display = "none"; }}
                />
                <span className={`text-xs truncate w-24 ${isMe ? "text-[#a8e4ff] font-semibold" : clickable ? "text-[#b8d4e8]" : "text-[#8ab0cc]"}`}>
                    {displayName}
                    {clickable && <span className="ml-1 text-[#3a6080] text-xs">↗</span>}
                </span>
                {/* Items */}
                <div className="flex gap-0.5 flex-1 justify-center">
                    {playerItems.map((id, i) => {
                        const url = itemIconUrl(id);
                        return url
                            ? <img key={i} src={url} alt="" className="w-5 h-5 rounded object-cover bg-[#0d1f38]" onError={e => { e.target.style.display = "none"; }} />
                            : <div key={i} className="w-5 h-5 rounded bg-[#0d1f38]/40" />;
                    })}
                </div>
                <span className="text-xs text-[#3a6080] tabular-nums shrink-0">
                    {p.kills}/{p.deaths}/{p.assists}
                </span>
                <span className="text-xs w-10 text-right shrink-0 tabular-nums text-[#5a8ab0]">
                    {kda}
                </span>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            {/* Team alleato */}
            <div>
                <p className="text-xs font-semibold text-[#4fc3f7] uppercase tracking-wider mb-1 px-2">
                    Il tuo team
                </p>
                <div className="space-y-0.5">
                    {myTeam.map((p, i) => <PlayerRow key={i} p={p} />)}
                </div>
            </div>
            {/* Team nemico */}
            <div>
                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1 px-2">
                    Avversari
                </p>
                <div className="space-y-0.5">
                    {enemies.map((p, i) => <PlayerRow key={i} p={p} />)}
                </div>
            </div>
        </div>
    );
}

function TimelinePanel({ matchId, myPuuid }) {
    const [timeline, setTimeline] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);

    async function load() {
        if (loaded) return;
        setLoading(true);
        try {
            const data = await invoke("get_match_timeline", { matchId });
            setTimeline(data);
        } catch (e) {
            console.error("[Timeline]", e);
            setTimeline(null);
        } finally {
            setLoading(false);
            setLoaded(true);
        }
    }

    // Carica automaticamente al mount
    useEffect(() => { load(); }, []);

    if (loading) return (
        <div className="text-xs text-[#3a6080] animate-pulse py-2">Loading timeline...</div>
    );
    if (!timeline) return null;

    // Estrai eventi ITEM_PURCHASED per il mio PUUID dal frame
    const frames = timeline?.info?.frames ?? [];
    const myPurchases = [];
    for (const frame of frames) {
        const timeMin = Math.floor((frame.timestamp ?? 0) / 60000);
        for (const ev of frame.events ?? []) {
            if (ev.type === "ITEM_PURCHASED" && ev.participantId != null) {
                // Trova il participantId corrispondente al mio puuid
                const participants = timeline?.info?.participants ?? [];
                const me = participants.find(p => p.puuid === myPuuid);
                if (me && ev.participantId === me.participantId) {
                    myPurchases.push({ itemId: ev.itemId, timeMin });
                }
            }
        }
    }

    // Raggruppa per minuto e deduplica sequenziali
    const grouped = myPurchases.reduce((acc, { itemId, timeMin }) => {
        if (!acc[timeMin]) acc[timeMin] = [];
        acc[timeMin].push(itemId);
        return acc;
    }, {});

    const minutes = Object.keys(grouped).map(Number).sort((a, b) => a - b);

    if (minutes.length === 0) return null;

    return (
        <div className="mt-3">
            <p className="text-[10px] font-mono tracking-[0.15em] text-[#4fc3f7]/60 uppercase mb-2 flex items-center gap-1">
                <ShoppingCart className="w-3 h-3" /> My Item Timeline
            </p>
            <div className="flex flex-wrap gap-3">
                {minutes.map(min => (
                    <div key={min} className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-[#3a6080] w-8 shrink-0">{min}m</span>
                        <div className="flex gap-0.5">
                            {grouped[min].map((id, i) => {
                                const url = itemIconUrl(id);
                                return url
                                    ? <img key={i} src={url} alt="" title={`Item ${id}`} className="w-6 h-6 rounded object-cover bg-[#0d1f38]" onError={e => { e.target.style.display = "none"; }} />
                                    : null;
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function MatchCard({ match, myPuuid, mySummonerName, onPlayerClick }) {
    const [open, setOpen] = useState(false);

    const info = match.info ?? match;
    const participants = info.participants ?? [];

    // Identifica il giocatore: PUUID prima (affidabile), poi nome (fallback)
    // mySummonerName e' "GameName#TAG" ma riotIdGameName non include il tag
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

    const won = me?.win ?? match.win ?? false;

    // Items dal participant trovato, oppure dalla struttura flat
    const items = me
        ? [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5, me.item6]
        : match.items?.length > 0
            ? match.items
            : [match.item0, match.item1, match.item2, match.item3, match.item4, match.item5, match.item6];

    // Campi principali: preferisce il participant "me", fallback su match flat
    const championName = me?.championName ?? match.championName;
    const champLevel = me?.champLevel ?? match.champLevel;
    const kills = me?.kills ?? match.kills ?? 0;
    const deaths = me?.deaths ?? match.deaths ?? 0;
    const assists = me?.assists ?? match.assists ?? 0;
    const totalMinionsKilled = me?.totalMinionsKilled ?? match.totalMinionsKilled ?? 0;
    const goldEarned = me?.goldEarned ?? match.goldEarned ?? 0;
    const visionScore = me?.visionScore ?? match.visionScore;
    const summonerSpells = me
        ? [me.summoner1Id, me.summoner2Id].filter(Boolean)
        : match.summonerSpells ?? [];
    const gameDuration = info.gameDuration ?? match.gameDuration;
    const gameCreation = info.gameCreation ?? match.gameCreation;
    const csPerMin = gameDuration > 0
        ? ((totalMinionsKilled / gameDuration) * 60).toFixed(1)
        : match.csPerMin ?? 0;
    const myTeamId = me?.teamId ?? match.teamId;

    const posIcon = POSITION_ICON[
        (me?.teamPosition ?? me?.individualPosition ?? match.position ?? "").toLowerCase()
    ] ?? "";

    return (
        <Card className={`border-l-4 ${won ? "border-l-green-500" : "border-l-red-500"} bg-[#070f1e] overflow-hidden`}>
            <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[#0d1f38]/40 transition-colors"
                onClick={() => setOpen(o => !o)}
            >
                {/* Champion */}
                <div className="relative shrink-0">
                    <img src={championIconUrl(championName)} alt={championName}
                        className="w-12 h-12 rounded-lg object-cover bg-[#0d1f38]"
                        onError={e => { e.target.style.display = "none"; }} />
                    {champLevel && (
                        <div className="absolute -bottom-1 -right-1 bg-[#142545] text-white text-xs px-1 rounded leading-tight">{champLevel}</div>
                    )}
                    {posIcon && (
                        <div className="absolute -top-1 -left-1 text-xs leading-none">{posIcon}</div>
                    )}
                </div>

                {/* Win/loss + durata */}
                <div className="w-[4.5rem] shrink-0">
                    <p className={`font-bold text-sm ${won ? "text-green-400" : "text-red-400"}`}>
                        {won ? "Vittoria" : "Sconfitta"}
                    </p>
                    <p className="text-[#3a6080] text-xs flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />{formatDuration(gameDuration)}
                    </p>
                    {gameCreation && (
                        <p className="text-[#2a5070] text-xs">{formatDate(gameCreation)}</p>
                    )}
                </div>

                {/* Champion name + spells */}
                <div className="w-24 shrink-0 hidden sm:block">
                    <p className="text-white text-xs font-medium truncate">{championName}</p>
                    <SpellRow spells={summonerSpells} />
                </div>

                {/* KDA */}
                <KdaBar kills={kills} deaths={deaths} assists={assists} />

                {/* CS */}
                <div className="w-20 shrink-0 hidden md:block text-xs text-[#5a8ab0]">
                    <p>
                        {totalMinionsKilled} CS
                        {csPerMin > 0 && <span className="text-[#3a6080]"> ({csPerMin}/m)</span>}
                    </p>
                    {goldEarned > 0 && (
                        <p className="text-yellow-600">{(goldEarned / 1000).toFixed(1)}k gold</p>
                    )}
                </div>

                {/* Items */}
                <div className="flex-1 min-w-0">
                    <ItemRow items={items} />
                </div>

                {/* Rank LP (OP.GG flat structure) */}
                {match.tier && (
                    <div className="shrink-0 text-right hidden xl:block">
                        <p className="text-xs text-[#8ab0cc] font-medium">{match.tier} {match.division}</p>
                        <p className="text-xs text-[#3a6080]">{match.lp} LP</p>
                    </div>
                )}

                {/* Vision score */}
                {visionScore !== undefined && (
                    <div className="ml-auto text-right shrink-0 hidden sm:block">
                        <p className="text-[#5a8ab0] text-xs flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />{visionScore} vis
                        </p>
                    </div>
                )}

                <div className="text-[#2a5070] shrink-0 ml-auto">
                    {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
            </div>

            {/* Expanded */}
            {open && (
                <div className="px-3 pb-3 pt-1 border-t border-[#0f2040] space-y-3">
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#5a8ab0]">
                        <span>{totalMinionsKilled} CS{csPerMin > 0 ? ` (${csPerMin}/m)` : ""}</span>
                        {goldEarned > 0 && <span className="text-yellow-600">{(goldEarned / 1000).toFixed(1)}k gold</span>}
                        {visionScore !== undefined && <span>{visionScore} vision</span>}
                        {match.tier && <span className="text-[#8ab0cc]">{match.tier} {match.division} • {match.lp} LP</span>}
                        {match.queueLabel && <span>{match.queueLabel}</span>}
                        {(match.metadata?.matchId ?? match.matchId) && (
                            <span className="text-[#2a5070] font-mono text-xs">
                                #{(match.metadata?.matchId ?? match.matchId).toString().slice(-8)}
                            </span>
                        )}
                    </div>
                    <TeamsPanel
                        participants={participants}
                        myTeamId={myTeamId}
                        myPuuid={myPuuid}
                        mySummonerName={mySummonerName}
                        onPlayerClick={onPlayerClick}
                    />
                    {/* Timeline acquisti */}
                    {myPuuid && (match.metadata?.matchId ?? match.matchId) && (
                        <TimelinePanel
                            matchId={match.metadata?.matchId ?? match.matchId}
                            myPuuid={myPuuid}
                        />
                    )}
                </div>
            )}
        </Card>
    );
}

// resolveMe è ora in ./utils.js — re-export per compatibilità con profile-tab e altri
export { resolveMe } from "./utils";

const MATCHES_PER_PAGE = 10;

export function MatchHistoryTab({ matches, myPuuid, mySummonerName, onPlayerClick }) {
    const [visibleCount, setVisibleCount] = useState(MATCHES_PER_PAGE);

    if (!matches || matches.length === 0) {
        return (
            <div className="flex items-center justify-center h-64">
                <p className="text-[#3a6080]">Nessuna partita trovata.</p>
            </div>
        );
    }

    const resolved = matches.map(m => resolveMe(m, myPuuid, mySummonerName));

    const wins = resolved.filter(m => m.win).length;
    const losses = matches.length - wins;
    const wr = Math.round((wins / matches.length) * 100);
    const validKda = resolved.filter(m => m.deaths > 0);
    const avgKda = validKda.length
        ? (validKda.reduce((s, m) => s + (m.kills + m.assists) / m.deaths, 0) / validKda.length).toFixed(2)
        : "Perfect";

    const visibleMatches = matches.slice(0, visibleCount);
    const hasMore = visibleCount < matches.length;

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-5 p-3 bg-[#070f1e] rounded-xl border border-[#0f2040] text-sm flex-wrap">
                <span className="text-[#5a8ab0]">{matches.length} partite</span>
                <span>
                    <span className="text-green-400 font-semibold">{wins}V</span>
                    <span className="text-[#3a6080]"> / </span>
                    <span className="text-red-400 font-semibold">{losses}S</span>
                </span>
                <span className={`font-bold ${wr >= 55 ? "text-green-400" : wr >= 50 ? "text-[#4fc3f7]" : "text-red-400"}`}>
                    {wr}% WR
                </span>
                <span className="text-[#5a8ab0]">KDA medio: <span className="text-white">{avgKda}</span></span>
            </div>

            {visibleMatches.map((match, i) => (
                <MatchCard
                    key={match.metadata?.matchId ?? match.matchId ?? i}
                    match={match}
                    myPuuid={myPuuid}
                    mySummonerName={mySummonerName}
                    onPlayerClick={onPlayerClick}
                />
            ))}

            {hasMore && (
                <button
                    onClick={() => setVisibleCount(c => c + MATCHES_PER_PAGE)}
                    className="w-full py-2.5 rounded-xl border border-[#1a3558] bg-[#070f1e] text-[#5a8ab0] text-sm font-medium hover:bg-[#0d1f38] hover:text-[#7dd8ff] hover:border-[#244570] transition-all"
                >
                    Carica altre {Math.min(MATCHES_PER_PAGE, matches.length - visibleCount)} partite
                </button>
            )}
        </div>
    );
}