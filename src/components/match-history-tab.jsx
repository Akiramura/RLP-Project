import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Sword, Shield, Clock, TrendingUp } from "lucide-react";

const PATCH = "14.4.1";

function championIconUrl(championName) {
    return `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${championName}.png`;
}

function itemIconUrl(itemId) {
    if (!itemId || itemId === 0) return null;
    return `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/item/${itemId}.png`;
}

function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

export function MatchHistoryTab({ matches }) {
    if (!matches || matches.length === 0) {
        return (
            <div className="flex items-center justify-center h-64">
                <p className="text-slate-500">Nessuna partita trovata.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {matches.map((match) => {
                const won = match.win;
                const kda = match.deaths === 0
                    ? "Perfect"
                    : ((match.kills + match.assists) / match.deaths).toFixed(2);

                return (
                    <Card
                        key={match.matchId}
                        className={`p-4 border-l-4 ${won ? "border-l-green-500" : "border-l-red-500"} bg-slate-900`}
                    >
                        <div className="flex items-center gap-4">
                            {/* Champion icon */}
                            <div className="relative shrink-0">
                                <img
                                    src={championIconUrl(match.championName)}
                                    alt={match.championName}
                                    className="w-14 h-14 rounded-lg object-cover"
                                    onError={(e) => { e.target.style.display = "none"; }}
                                />
                                <div className="absolute -bottom-1 -right-1 bg-slate-700 text-white text-xs px-1 rounded">
                                    {match.champLevel}
                                </div>
                            </div>

                            {/* Win/Loss + queue */}
                            <div className="w-20 shrink-0">
                                <p className={`font-bold text-sm ${won ? "text-green-400" : "text-red-400"}`}>
                                    {won ? "Vittoria" : "Sconfitta"}
                                </p>
                                <p className="text-slate-400 text-xs">{match.queueLabel || "Ranked Solo"}</p>
                                <p className="text-slate-500 text-xs flex items-center gap-1 mt-1">
                                    <Clock className="w-3 h-3" />
                                    {formatDuration(match.gameDuration)}
                                </p>
                            </div>

                            {/* KDA */}
                            <div className="w-28 shrink-0">
                                <p className="text-white font-bold text-sm">
                                    {match.kills} / <span className="text-red-400">{match.deaths}</span> / {match.assists}
                                </p>
                                <p className="text-slate-400 text-xs">
                                    <span className={kda === "Perfect" ? "text-yellow-400" : "text-blue-400"}>
                                        {kda}
                                    </span> KDA
                                </p>
                                <p className="text-slate-500 text-xs">{match.totalMinionsKilled} CS</p>
                            </div>

                            {/* Items */}
                            <div className="flex gap-1 flex-wrap">
                                {[match.item0, match.item1, match.item2, match.item3, match.item4, match.item5, match.item6]
                                    .map((itemId, i) => (
                                        itemIconUrl(itemId) ? (
                                            <img
                                                key={i}
                                                src={itemIconUrl(itemId)}
                                                alt={`item${i}`}
                                                className="w-8 h-8 rounded object-cover bg-slate-800"
                                                onError={(e) => { e.target.style.display = "none"; }}
                                            />
                                        ) : (
                                            <div key={i} className="w-8 h-8 rounded bg-slate-800" />
                                        )
                                    ))}
                            </div>

                            {/* Stats aggiuntive */}
                            <div className="ml-auto text-right shrink-0">
                                <p className="text-slate-400 text-xs flex items-center justify-end gap-1">
                                    <TrendingUp className="w-3 h-3" />
                                    {match.visionScore} vision
                                </p>
                                <p className="text-slate-500 text-xs">{match.goldEarned?.toLocaleString()} gold</p>
                            </div>
                        </div>
                    </Card>
                );
            })}
        </div>
    );
}
