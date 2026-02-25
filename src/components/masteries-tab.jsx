import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Loader2, Star } from "lucide-react";
import { PATCH } from "./constants";
import { getChampionMap } from "./utils";

// Mappa champion key (numero stringa) → nome DDragon — usa singleton condiviso
function useChampKeyMap() {
    const [map, setMap] = useState({});
    useEffect(() => {
        let cancelled = false;
        getChampionMap().then(({ byKey }) => { if (!cancelled) setMap(byKey); });
        return () => { cancelled = true; };
    }, []);
    return map;
}

function formatPoints(pts) {
    if (!pts) return "0";
    if (pts >= 1_000_000) return `${(pts / 1_000_000).toFixed(2)}M`;
    if (pts >= 1_000) return `${(pts / 1_000).toFixed(0)}k`;
    return String(pts);
}

const MASTERY_COLORS = {
    7: "text-yellow-300",
    6: "text-purple-300",
    5: "text-red-300",
};

export function MasteriesTab({ puuid, profile }) {
    const [masteries, setMasteries] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const champKeyMap = useChampKeyMap();

    useEffect(() => {
        if (!puuid) return;
        setLoading(true);
        setError(null);
        invoke("get_summoner_masteries", { puuid })
            .then(data => setMasteries(Array.isArray(data) ? data : []))
            .catch(e => setError(String(e)))
            .finally(() => setLoading(false));
    }, [puuid]);

    if (!puuid) {
        return (
            <div className="flex items-center justify-center h-64">
                <p className="text-[#3a6080]">Nessun summoner selezionato.</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 gap-3">
                <Loader2 className="w-6 h-6 text-[#4fc3f7] animate-spin" />
                <p className="text-[#5a8ab0]">Caricamento maestrie...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-64">
                <p className="text-red-400 text-sm">Errore: {error}</p>
            </div>
        );
    }

    if (!masteries || masteries.length === 0) {
        return (
            <div className="flex items-center justify-center h-64">
                <p className="text-[#3a6080]">Nessuna maestria trovata.</p>
            </div>
        );
    }

    const totalPoints = masteries.reduce((s, m) => s + (m.championPoints ?? 0), 0);
    const m7 = masteries.filter(m => m.championLevel >= 7).length;
    const m6 = masteries.filter(m => m.championLevel === 6).length;
    const m5 = masteries.filter(m => m.championLevel === 5).length;

    return (
        <div className="space-y-6">
            {/* Header summary */}
            <Card className="p-5 bg-gradient-to-br from-[#070f1e] to-[#0d1f38] border-yellow-900/40">
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <Star className="w-6 h-6 text-yellow-400" />
                        <div>
                            <p className="text-white font-bold text-lg">{profile?.gameName ?? "Summoner"}</p>
                            <p className="text-[#5a8ab0] text-xs">{masteries.length} campioni con maestria</p>
                        </div>
                    </div>
                    <div className="flex gap-3 ml-auto flex-wrap">
                        <div className="bg-[#0d1f38] border border-[#1a3558] rounded-lg px-3 py-2 text-center">
                            <p className="text-yellow-300 font-bold">{formatPoints(totalPoints)}</p>
                            <p className="text-[#3a6080] text-xs">Punti totali</p>
                        </div>
                        {m7 > 0 && (
                            <div className="bg-[#0d1f38] border border-[#1a3558] rounded-lg px-3 py-2 text-center">
                                <p className="text-yellow-300 font-bold">{m7}</p>
                                <p className="text-[#3a6080] text-xs">M7</p>
                            </div>
                        )}
                        {m6 > 0 && (
                            <div className="bg-[#0d1f38] border border-[#1a3558] rounded-lg px-3 py-2 text-center">
                                <p className="text-purple-300 font-bold">{m6}</p>
                                <p className="text-[#3a6080] text-xs">M6</p>
                            </div>
                        )}
                        {m5 > 0 && (
                            <div className="bg-[#0d1f38] border border-[#1a3558] rounded-lg px-3 py-2 text-center">
                                <p className="text-red-300 font-bold">{m5}</p>
                                <p className="text-[#3a6080] text-xs">M5</p>
                            </div>
                        )}
                    </div>
                </div>
            </Card>

            {/* Top 3 spotlight */}
            <div className="grid grid-cols-3 gap-4">
                {masteries.slice(0, 3).map((m, i) => {
                    const champName = champKeyMap[String(m.championId)] ?? `Champ ${m.championId}`;
                    const lvlColor = MASTERY_COLORS[m.championLevel] ?? "text-[#5a8ab0]";
                    const sizes = ["w-24 h-24", "w-20 h-20", "w-16 h-16"];
                    return (
                        <Card key={m.championId} className={`p-4 bg-[#070f1e] border-[#1a3558] flex flex-col items-center gap-2 ${i === 0 ? "border-yellow-700/50" : ""}`}>
                            <div className="relative">
                                <img
                                    src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${champName}.png`}
                                    alt={champName}
                                    className={`${sizes[i]} rounded-xl object-cover border-2 ${i === 0 ? "border-yellow-600/60" : "border-[#1a3558]"}`}
                                    onError={e => { e.target.style.display = "none"; }}
                                />
                                <Badge className={`absolute -bottom-2 left-1/2 -translate-x-1/2 ${lvlColor} bg-[#070f1e] border border-[#1a3558] text-xs px-1.5`}>
                                    M{m.championLevel}
                                </Badge>
                            </div>
                            <p className="text-white font-semibold text-sm mt-2">{champName}</p>
                            <p className={`font-bold text-sm ${lvlColor}`}>{formatPoints(m.championPoints)}</p>
                            {i === 0 && <span className="text-yellow-500 text-xs">👑 #1</span>}
                        </Card>
                    );
                })}
            </div>

            {/* Full list */}
            <Card className="p-4 bg-[#070f1e] border-[#1a3558] hover:border-[#244570] transition-colors">
                <h3 className="text-sm font-semibold text-[#5a8ab0] uppercase tracking-wider mb-3">
                    Tutte le maestrie
                </h3>
                <div className="space-y-1 max-h-[520px] overflow-y-auto pr-1">
                    {masteries.map((m, idx) => {
                        const champName = champKeyMap[String(m.championId)] ?? `Champ ${m.championId}`;
                        const lvlColor = MASTERY_COLORS[m.championLevel] ?? "text-[#3a6080]";
                        const topPct = masteries.length > 0 ? (m.championPoints / masteries[0].championPoints) * 100 : 0;
                        return (
                            <div key={m.championId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#0d1f38]/60 transition-colors">
                                <span className="text-[#2a5070] text-xs w-5 shrink-0 text-right">{idx + 1}</span>
                                <img
                                    src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${champName}.png`}
                                    alt={champName}
                                    className="w-9 h-9 rounded-lg object-cover shrink-0"
                                    onError={e => { e.target.style.display = "none"; }}
                                />
                                <div className="w-28 shrink-0">
                                    <p className="text-white text-sm font-medium truncate">{champName}</p>
                                    <p className={`text-xs font-bold ${lvlColor}`}>M{m.championLevel}</p>
                                </div>
                                {/* Progress bar */}
                                <div className="flex-1 min-w-0">
                                    <div className="h-1.5 bg-[#0d1f38] rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all ${m.championLevel >= 7 ? "bg-yellow-500" : m.championLevel >= 6 ? "bg-purple-500" : m.championLevel >= 5 ? "bg-red-500" : "bg-[#1e3560]"}`}
                                            style={{ width: `${Math.max(2, topPct)}%` }}
                                        />
                                    </div>
                                </div>
                                <div className="text-right shrink-0 w-20">
                                    <p className="text-white text-xs font-mono font-semibold">{formatPoints(m.championPoints)}</p>
                                    {m.championPointsUntilNextLevel > 0 && m.championLevel < 7 && (
                                        <p className="text-[#2a5070] text-xs">{formatPoints(m.championPointsUntilNextLevel)} to next</p>
                                    )}
                                </div>
                                {m.chestGranted && (
                                    <span title="Forziere già ottenuto" className="text-yellow-600 text-xs shrink-0">🎁</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </Card>
        </div>
    );
}