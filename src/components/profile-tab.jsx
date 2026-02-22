import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Trophy, Swords, Eye, Tv } from "lucide-react";
import { Button } from "./ui/button";
import { PATCH } from "./constants";
import { resolveMe } from "./match-history-tab";

export function ProfileTab({ profile, rankedSolo, rankedFlex, matches, myPuuid, mySummonerName, onViewLiveGame, isInLiveGame }) {
    if (!profile) return null;

    const level = profile.summonerLevel || 0;
    const initials = profile.gameName
        ? profile.gameName.substring(0, 2).toUpperCase()
        : "SN";

    const xpCurrent = profile.xpSinceLastLevel || 0;
    const xpTotal = profile.xpUntilNextLevel || 1;
    const xpPercent = Math.round((xpCurrent / xpTotal) * 100);

    const soloTotal = rankedSolo ? (rankedSolo.wins + rankedSolo.losses) : 0;
    const flexTotal = rankedFlex ? (rankedFlex.wins + rankedFlex.losses) : 0;
    const soloWR = soloTotal > 0 ? ((rankedSolo.wins / soloTotal) * 100).toFixed(1) : 0;
    const flexWR = flexTotal > 0 ? ((rankedFlex.wins / flexTotal) * 100).toFixed(1) : 0;

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
            const r = resolveMe(m, myPuuid, mySummonerName);
            if (!r?.championName) return;
            const name = r.championName;
            if (!champStats[name]) {
                champStats[name] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
            }
            champStats[name].games += 1;
            champStats[name].wins += r.win ? 1 : 0;
            champStats[name].kills += r.kills || 0;
            champStats[name].deaths += r.deaths || 0;
            champStats[name].assists += r.assists || 0;
        });
    }

    const topChampions = Object.entries(champStats)
        .map(([name, stats]) => ({
            name,
            games: stats.games,
            wins: stats.wins,
            losses: stats.games - stats.wins,
            winRate: ((stats.wins / stats.games) * 100).toFixed(1),
            kda: stats.deaths === 0
                ? "Perfect"
                : ((stats.kills + stats.assists) / stats.deaths).toFixed(2),
            avgKills: (stats.kills / stats.games).toFixed(1),
            avgDeaths: (stats.deaths / stats.games).toFixed(1),
            avgAssists: (stats.assists / stats.games).toFixed(1),
        }))
        .sort((a, b) => b.games - a.games)
        .slice(0, 7);

    // --- Calcola Performance Stats dai match reali ---
    const perfStats = matches && matches.length > 0 ? (() => {
        const totals = matches.reduce((acc, m) => {
            const r = resolveMe(m, myPuuid, mySummonerName);
            return {
                kills: acc.kills + (r.kills || 0),
                deaths: acc.deaths + (r.deaths || 0),
                assists: acc.assists + (r.assists || 0),
            };
        }, { kills: 0, deaths: 0, assists: 0 });

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
                        <div className="flex items-center gap-3 mb-4 flex-wrap">
                            {rankedSolo && (
                                <Badge className={`bg-gradient-to-r ${soloColor} text-white border-0`}>
                                    <Trophy className="w-3 h-3 mr-1" />
                                    {rankedSolo.tier} {rankedSolo.rank}
                                </Badge>
                            )}
                            <span className="text-slate-400">Level {level}</span>
                            {onViewLiveGame && myPuuid && (
                                <Button
                                    onClick={() => onViewLiveGame(myPuuid)}
                                    className={`text-white text-xs px-3 py-1 h-7 flex items-center gap-1.5 relative ${isInLiveGame
                                        ? "bg-red-600 hover:bg-red-500 shadow-lg shadow-red-900/40"
                                        : "bg-slate-700 hover:bg-slate-600"
                                        }`}
                                >
                                    <Tv className="w-3 h-3" />
                                    {isInLiveGame ? "In partita! →" : "Vedi in gioco"}
                                    {isInLiveGame && (
                                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                                    )}
                                </Button>
                            )}
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

            {/* Most Played Champions — stile OP.GG */}
            {topChampions.length > 0 && (
                <Card className="p-6 bg-slate-900 border-slate-700">
                    <h3 className="text-xl font-bold text-white mb-4">Most Played Champions</h3>
                    <div className="space-y-2">
                        {topChampions.map((champ, idx) => {
                            const wrNum = parseFloat(champ.winRate);
                            const wrColor = wrNum >= 60 ? "text-green-400" : wrNum >= 50 ? "text-blue-400" : "text-red-400";
                            const barColor = wrNum >= 60 ? "bg-green-500" : wrNum >= 50 ? "bg-blue-500" : "bg-red-500";
                            return (
                                <div key={champ.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/60 transition-colors">
                                    {/* Rank number */}
                                    <span className="text-slate-600 text-xs w-4 shrink-0">{idx + 1}</span>
                                    {/* Champion icon */}
                                    <img
                                        src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${champ.name}.png`}
                                        alt={champ.name}
                                        className="w-10 h-10 rounded-lg object-cover shrink-0"
                                        onError={e => { e.target.style.display = "none"; }}
                                    />
                                    {/* Name + games */}
                                    <div className="w-28 shrink-0">
                                        <p className="text-white font-semibold text-sm truncate">{champ.name}</p>
                                        <p className="text-slate-500 text-xs">{champ.games} partite</p>
                                    </div>
                                    {/* WR bar */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-slate-400">{champ.wins}V {champ.losses}S</span>
                                            <span className={`font-bold ${wrColor}`}>{champ.winRate}%</span>
                                        </div>
                                        <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${champ.winRate}%` }} />
                                        </div>
                                    </div>
                                    {/* KDA */}
                                    <div className="text-right shrink-0 w-24">
                                        <p className="text-white text-sm font-mono">
                                            <span className="text-slate-300">{champ.avgKills}</span>
                                            <span className="text-slate-500"> / </span>
                                            <span className="text-red-400">{champ.avgDeaths}</span>
                                            <span className="text-slate-500"> / </span>
                                            <span className="text-slate-300">{champ.avgAssists}</span>
                                        </p>
                                        <p className="text-xs">
                                            <span className={parseFloat(champ.kda) >= 3 || champ.kda === "Perfect" ? "text-yellow-400" : parseFloat(champ.kda) >= 2 ? "text-blue-400" : "text-slate-500"}>
                                                {champ.kda}
                                            </span>
                                            <span className="text-slate-600"> KDA</span>
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
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