import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const PATCH = "14.4.1";

function championIconUrl(championName) {
    return `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${championName}.png`;
}

const MOCK_META = [
    { name: "Jinx", role: "ADC", winRate: 52.3, pickRate: 14.2, banRate: 8.1, tier: "S", trend: "up" },
    { name: "Thresh", role: "Support", winRate: 51.8, pickRate: 18.5, banRate: 5.2, tier: "S", trend: "stable" },
    { name: "Zed", role: "Mid", winRate: 50.1, pickRate: 12.3, banRate: 22.4, tier: "A", trend: "down" },
    { name: "Vi", role: "Jungle", winRate: 53.2, pickRate: 9.8, banRate: 3.1, tier: "S", trend: "up" },
    { name: "Darius", role: "Top", winRate: 51.5, pickRate: 11.2, banRate: 15.3, tier: "A", trend: "stable" },
    { name: "Lux", role: "Support", winRate: 52.7, pickRate: 16.4, banRate: 6.8, tier: "S", trend: "up" },
    { name: "Yasuo", role: "Mid", winRate: 49.3, pickRate: 13.1, banRate: 19.7, tier: "B", trend: "down" },
    { name: "Caitlyn", role: "ADC", winRate: 51.9, pickRate: 15.6, banRate: 7.4, tier: "A", trend: "stable" },
];

const tierColors = {
    S: "bg-gradient-to-r from-yellow-500 to-yellow-400 text-black",
    A: "bg-gradient-to-r from-green-600 to-green-500 text-white",
    B: "bg-gradient-to-r from-blue-600 to-blue-500 text-white",
    C: "bg-gradient-to-r from-slate-600 to-slate-500 text-white",
};

const roleColors = {
    ADC: "text-red-400",
    Support: "text-teal-400",
    Mid: "text-blue-400",
    Jungle: "text-green-400",
    Top: "text-orange-400",
};

export function ChampionMetaTab() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Champion Meta — Patch {PATCH.slice(0, -2)}</h2>
                <Badge className="bg-slate-700 text-slate-300 text-xs">Dati statistici</Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {MOCK_META.map((champ) => (
                    <Card key={champ.name} className="p-4 bg-slate-900 border-slate-800">
                        <div className="flex items-center gap-4">
                            {/* Icon */}
                            <img
                                src={championIconUrl(champ.name)}
                                alt={champ.name}
                                className="w-12 h-12 rounded-lg object-cover"
                                onError={(e) => { e.target.style.display = "none"; }}
                            />

                            {/* Name + Role */}
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <p className="text-white font-bold">{champ.name}</p>
                                    <Badge className={`${tierColors[champ.tier]} text-xs`}>
                                        {champ.tier}
                                    </Badge>
                                    {champ.trend === "up" && <TrendingUp className="w-4 h-4 text-green-400" />}
                                    {champ.trend === "down" && <TrendingDown className="w-4 h-4 text-red-400" />}
                                    {champ.trend === "stable" && <Minus className="w-4 h-4 text-slate-400" />}
                                </div>
                                <p className={`text-xs font-semibold ${roleColors[champ.role] || "text-slate-400"}`}>
                                    {champ.role}
                                </p>
                            </div>

                            {/* Stats */}
                            <div className="text-right space-y-1">
                                <p className="text-green-400 text-sm font-bold">{champ.winRate}% WR</p>
                                <p className="text-slate-400 text-xs">{champ.pickRate}% Pick</p>
                                <p className="text-red-400 text-xs">{champ.banRate}% Ban</p>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>

            <p className="text-center text-slate-600 text-xs">
                * Dati placeholder — integrazione API meta in arrivo
            </p>
        </div>
    );
}
