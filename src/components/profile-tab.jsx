import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Trophy, Swords, Eye, Coins } from "lucide-react";

const PATCH = "16.4.1";

export function ProfileTab({ profile, rankedSolo, rankedFlex, matches }) {
    if (!profile) return null;

    const level = profile.summonerLevel || 0;
    const initials = profile.gameName
        ? profile.gameName.substring(0, 2).toUpperCase()
        : "SN";

    const xpCurrent = profile.xpSinceLastLevel || 0;
    const xpTotal = profile.xpUntilNextLevel || 1;
    const xpPercent = Math.round((xpCurrent / xpTotal) * 100);

    const soloWR = rankedSolo
        ? ((rankedSolo.wins / (rankedSolo.wins + rankedSolo.losses)) * 100).toFixed(1)
        : 0;
    const flexWR = rankedFlex
        ? ((rankedFlex.wins / (rankedFlex.wins + rankedFlex.losses)) * 100).toFixed(1)
        : 0;

    const tierColors = {
        IRON: "from-slate-500 to-slate-400",
        BRONZE: "from-amber-800 to-amber-600",
        SILVER: "from-slate-400 to-slate-300",
        GOLD: "from-yellow-600 to-yellow-400",
        PLATINUM: "from-teal-500 to-teal-300",
        EMERALD: "from-emerald-600 to-emerald-400",
        DIAMOND: "from-blue-500 to-cyan-400",
        MASTER: "from-purple-600 to-purple-400",
        GRANDMASTER: "from-red-600 to-red-400",
        CHALLENGER: "from-yellow-400 to-yellow-200",
    };

    const soloColor = tierColors[rankedSolo?.tier] || "from-slate-600 to-slate-500";
    const flexColor = tierColors[rankedFlex?.tier] || "from-slate-600 to-slate-500";

    // --- Calcola Top Champions dai match reali ---
    const champStats = {};
    if (matches && matches.length > 0) {
        matches.forEach(m => {
            if (!m?.championName) return;
            const name = m.championName;
            if (!champStats[name]) {
                champStats[name] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
            }
            champStats[name].games += 1;
            champStats[name].wins += m.win ? 1 : 0;
            champStats[name].kills += m.kills || 0;
            champStats[name].deaths += m.deaths || 0;
            champStats[name].assists += m.assists || 0;
        });
    }

    const topChampions = Object.entries(champStats)
        .map(([name, stats]) => ({
            name,
            games: stats.games,
            winRate: ((stats.wins / stats.games) * 100).toFixed(1),
            kda: stats.deaths === 0
                ? "Perfect"
                : ((stats.kills + stats.assists) / stats.deaths).toFixed(2),
        }))
        .sort((a, b) => b.games - a.games)
        .slice(0, 3);

    // --- Calcola Performance Stats dai match reali ---
    const perfStats = matches && matches.length > 0 ? (() => {
        const totals = matches.reduce((acc, m) => ({
            kills: acc.kills + (m.kills || 0),
            deaths: acc.deaths + (m.deaths || 0),
            assists: acc.assists + (m.assists || 0),
        }), { kills: 0, deaths: 0, assists: 0 });

        const avgKills = (totals.kills / matches.length).toFixed(1);
        const avgDeaths = (totals.deaths / matches.length).toFixed(1);
        const avgAssists = (totals.assists / matches.length).toFixed(1);
        const kda = totals.deaths === 0
            ? "Perfect"
            : ((totals.kills + totals.assists) / totals.deaths).toFixed(2);

        return { avgKills, avgDeaths, avgAssists, kda };
    })() : null;

    return (
        <div className="space-y-6">
            {/* Summoner Info */}
            <Card className="p-6 bg-gradient-to-br from-slate-900 to-slate-800 border-blue-900">
                <div className="flex items-start gap-6">
                    {/* Sostituisci il div con le iniziali con questo */}
                    <div className="relative">
                        <img
                            src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/profileicon/${profile.profileIconId}.png`}
                            alt="Profile Icon"
                            className="w-24 h-24 rounded-lg object-cover"
                            onError={e => {
                                // Fallback alle iniziali se l'immagine non carica
                                e.target.style.display = "none";
                                e.target.nextSibling.style.display = "flex";
                            }}
                        />
                        <div
                            className="w-24 h-24 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 items-center justify-center text-white text-4xl font-bold hidden"
                        >
                            {initials}
                        </div>
                        <div className="absolute -bottom-2 -right-2 bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded">
                            {level}
                        </div>
                    </div>
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold text-white mb-2">
                            {profile.gameName}#{profile.tagLine}
                        </h1>
                        <div className="flex items-center gap-3 mb-4">
                            {rankedSolo && (
                                <Badge className={`bg-gradient-to-r ${soloColor} text-white border-0`}>
                                    <Trophy className="w-3 h-3 mr-1" />
                                    {rankedSolo.tier} {rankedSolo.rank}
                                </Badge>
                            )}
                            <span className="text-slate-400">Level {level}</span>
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-400">XP Progress</span>
                                <span className="text-white">{xpCurrent.toLocaleString()} / {xpTotal.toLocaleString()}</span>
                            </div>
                            <Progress value={xpPercent} className="h-2" />
                        </div>
                    </div>
                </div>
            </Card>

            {/* Ranked Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-6 bg-slate-900 border-blue-900">
                    <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                        <Trophy className="w-5 h-5 text-yellow-500" />
                        Ranked Solo/Duo
                    </h3>
                    {rankedSolo ? (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400">Rank</span>
                                <Badge className={`bg-gradient-to-r ${soloColor} text-white border-0`}>
                                    {rankedSolo.tier} {rankedSolo.rank}
                                </Badge>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400">LP</span>
                                <span className="text-white font-bold">{rankedSolo.leaguePoints} LP</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400">Win Rate</span>
                                <span className="text-green-500 font-bold">{soloWR}%</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400">Games</span>
                                <span className="text-white">{rankedSolo.wins} W / {rankedSolo.losses} L</span>
                            </div>
                        </div>
                    ) : (
                        <p className="text-slate-400">Unranked</p>
                    )}
                </Card>

                <Card className="p-6 bg-slate-900 border-purple-900">
                    <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                        <Trophy className="w-5 h-5 text-purple-500" />
                        Ranked Flex
                    </h3>
                    {rankedFlex ? (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400">Rank</span>
                                <Badge className={`bg-gradient-to-r ${flexColor} text-white border-0`}>
                                    {rankedFlex.tier} {rankedFlex.rank}
                                </Badge>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400">LP</span>
                                <span className="text-white font-bold">{rankedFlex.leaguePoints} LP</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400">Win Rate</span>
                                <span className="text-green-500 font-bold">{flexWR}%</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-slate-400">Games</span>
                                <span className="text-white">{rankedFlex.wins} W / {rankedFlex.losses} L</span>
                            </div>
                        </div>
                    ) : (
                        <p className="text-slate-400">Unranked</p>
                    )}
                </Card>
            </div>

            {/* Top Champions */}
            {topChampions.length > 0 && (
                <Card className="p-6 bg-slate-900 border-slate-700">
                    <h3 className="text-xl font-bold text-white mb-4">Top Champions</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {topChampions.map(champ => (
                            <div key={champ.name} className="bg-slate-800 rounded-lg p-4 flex flex-col gap-3">
                                <div className="flex items-center gap-3">
                                    <img
                                        src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${champ.name}.png`}
                                        alt={champ.name}
                                        className="w-12 h-12 rounded-lg object-cover"
                                        onError={e => { e.target.style.display = "none"; }}
                                    />
                                    <div>
                                        <p className="text-white font-bold">{champ.name}</p>
                                        <p className="text-slate-400 text-xs">{champ.games} games</p>
                                    </div>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">Win Rate</span>
                                    <span className="text-green-400 font-bold">{champ.winRate}%</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-400">KDA</span>
                                    <span className="text-blue-400 font-bold">{champ.kda}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Performance Stats */}
            {perfStats && (
                <Card className="p-6 bg-slate-900 border-slate-700">
                    <h3 className="text-xl font-bold text-white mb-4">Performance Stats</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-slate-800 rounded-lg p-4 text-center">
                            <Swords className="w-6 h-6 text-red-400 mx-auto mb-2" />
                            <p className="text-2xl font-bold text-white">{perfStats.avgKills}</p>
                            <p className="text-slate-400 text-xs">Avg Kills</p>
                        </div>
                        <div className="bg-slate-800 rounded-lg p-4 text-center">
                            <Eye className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                            <p className="text-2xl font-bold text-white">{perfStats.avgDeaths}</p>
                            <p className="text-slate-400 text-xs">Avg Deaths</p>
                        </div>
                        <div className="bg-slate-800 rounded-lg p-4 text-center">
                            <Swords className="w-6 h-6 text-purple-400 mx-auto mb-2" />
                            <p className="text-2xl font-bold text-white">{perfStats.avgAssists}</p>
                            <p className="text-slate-400 text-xs">Avg Assists</p>
                        </div>
                        <div className="bg-slate-800 rounded-lg p-4 text-center">
                            <Trophy className="w-6 h-6 text-yellow-400 mx-auto mb-2" />
                            <p className="text-2xl font-bold text-white">{perfStats.kda}</p>
                            <p className="text-slate-400 text-xs">KDA Ratio</p>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}