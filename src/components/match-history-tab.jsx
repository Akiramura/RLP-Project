import { Card } from "./ui/card";
import { Clock, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

const PATCH = "16.4.1";

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
                <span className={good ? "text-yellow-400" : bad ? "text-slate-400" : "text-blue-400"}>{kda}</span>
                <span className="text-slate-500"> KDA</span>
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
                    ? <img key={i} src={url} alt={`item${i}`} className="w-7 h-7 rounded object-cover bg-slate-800" onError={e => { e.target.style.display = "none"; }} />
                    : <div key={i} className="w-7 h-7 rounded bg-slate-800/60" />;
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
                    ? <img key={i} src={url} alt={`sp${i}`} className="w-6 h-6 rounded object-cover bg-slate-800" onError={e => { e.target.style.display = "none"; }} />
                    : <div key={i} className="w-6 h-6 rounded bg-slate-800/60" />;
            })}
        </div>
    );
}

function MatchCard({ match }) {
    const [open, setOpen] = useState(false);
    const won = match.win;

    // Unifica items: supporta sia items[] (OP.GG) che item0-item6 (Riot API)
    const items = match.items?.length > 0
        ? match.items
        : [match.item0, match.item1, match.item2, match.item3, match.item4, match.item5, match.item6];

    const posIcon = POSITION_ICON[match.position?.toLowerCase()] ?? "";

    return (
        <Card className={`border-l-4 ${won ? "border-l-green-500" : "border-l-red-500"} bg-slate-900 overflow-hidden`}>
            <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-800/40 transition-colors"
                onClick={() => setOpen(o => !o)}
            >
                {/* Champion */}
                <div className="relative shrink-0">
                    <img src={championIconUrl(match.championName)} alt={match.championName}
                        className="w-12 h-12 rounded-lg object-cover bg-slate-800"
                        onError={e => { e.target.style.display = "none"; }} />
                    {match.champLevel && (
                        <div className="absolute -bottom-1 -right-1 bg-slate-700 text-white text-xs px-1 rounded leading-tight">{match.champLevel}</div>
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
                    <p className="text-slate-500 text-xs flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />{formatDuration(match.gameDuration)}
                    </p>
                    {match.gameCreation && (
                        <p className="text-slate-600 text-xs">{formatDate(match.gameCreation)}</p>
                    )}
                </div>

                {/* Champion name + spells */}
                <div className="w-24 shrink-0 hidden sm:block">
                    <p className="text-white text-xs font-medium truncate">{match.championName}</p>
                    <SpellRow spells={match.summonerSpells} />
                </div>

                {/* KDA */}
                <KdaBar kills={match.kills} deaths={match.deaths} assists={match.assists} />

                {/* CS */}
                <div className="w-20 shrink-0 hidden md:block text-xs text-slate-400">
                    <p>
                        {match.totalMinionsKilled} CS
                        {match.csPerMin > 0 && <span className="text-slate-500"> ({match.csPerMin}/m)</span>}
                    </p>
                    {match.goldEarned > 0 && (
                        <p className="text-yellow-600">{(match.goldEarned / 1000).toFixed(1)}k gold</p>
                    )}
                </div>

                {/* Items */}
                <div className="flex-1 min-w-0 hidden lg:block">
                    <ItemRow items={items} />
                </div>

                {/* Rank LP (OP.GG) */}
                {match.tier && (
                    <div className="shrink-0 text-right hidden xl:block">
                        <p className="text-xs text-slate-300 font-medium">{match.tier} {match.division}</p>
                        <p className="text-xs text-slate-500">{match.lp} LP</p>
                    </div>
                )}

                {/* Vision score (Riot API) */}
                {match.visionScore !== undefined && (
                    <div className="ml-auto text-right shrink-0 hidden sm:block">
                        <p className="text-slate-400 text-xs flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />{match.visionScore} vis
                        </p>
                    </div>
                )}

                <div className="text-slate-600 shrink-0 ml-auto">
                    {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
            </div>

            {/* Expanded */}
            {open && (
                <div className="px-3 pb-3 pt-1 border-t border-slate-800 space-y-2">
                    <div className="lg:hidden">
                        <p className="text-slate-500 text-xs mb-1">Items</p>
                        <ItemRow items={items} />
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
                        <span>{match.totalMinionsKilled} CS{match.csPerMin > 0 ? ` (${match.csPerMin}/m)` : ""}</span>
                        {match.goldEarned > 0 && <span className="text-yellow-600">{(match.goldEarned / 1000).toFixed(1)}k gold</span>}
                        {match.visionScore !== undefined && <span>{match.visionScore} vision</span>}
                        {match.tier && <span className="text-slate-300">{match.tier} {match.division} • {match.lp} LP</span>}
                        {match.queueLabel && <span>{match.queueLabel}</span>}
                        {match.matchId && <span className="text-slate-600 font-mono text-xs">#{match.matchId.toString().slice(-8)}</span>}
                    </div>
                </div>
            )}
        </Card>
    );
}

export function MatchHistoryTab({ matches }) {
    if (!matches || matches.length === 0) {
        return (
            <div className="flex items-center justify-center h-64">
                <p className="text-slate-500">Nessuna partita trovata.</p>
            </div>
        );
    }

    const wins = matches.filter(m => m.win).length;
    const losses = matches.length - wins;
    const wr = Math.round((wins / matches.length) * 100);
    const validKda = matches.filter(m => m.deaths > 0);
    const avgKda = validKda.length
        ? (validKda.reduce((s, m) => s + (m.kills + m.assists) / m.deaths, 0) / validKda.length).toFixed(2)
        : "Perfect";

    return (
        <div className="space-y-3">
            {/* Summary bar */}
            <div className="flex items-center gap-5 p-3 bg-slate-900 rounded-xl border border-slate-800 text-sm flex-wrap">
                <span className="text-slate-400">{matches.length} partite</span>
                <span>
                    <span className="text-green-400 font-semibold">{wins}V</span>
                    <span className="text-slate-500"> / </span>
                    <span className="text-red-400 font-semibold">{losses}S</span>
                </span>
                <span className={`font-bold ${wr >= 55 ? "text-green-400" : wr >= 50 ? "text-blue-400" : "text-red-400"}`}>
                    {wr}% WR
                </span>
                <span className="text-slate-400">KDA medio: <span className="text-white">{avgKda}</span></span>
            </div>

            {matches.map((match, i) => (
                <MatchCard key={match.matchId ?? i} match={match} />
            ))}
        </div>
    );
}