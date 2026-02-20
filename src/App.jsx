import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ProfileTab } from "./components/profile-tab";
import { MatchHistoryTab } from "./components/match-history-tab";
import { ChampionMetaTab } from "./components/champion-meta-tab";
import { MetaTab } from "./components/meta-tab";
import { User, History, TrendingUp, Search, BarChart2 } from "lucide-react";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import "./App.css";

export default function App() {
    const [profileData, setProfileData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [allMatches, setAllMatches] = useState([]);
    const [matchOffset, setMatchOffset] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);
    const matchesInitialized = useRef(false);

    const [seasonFetchDone, setSeasonFetchDone] = useState(false);
    const seasonFetchRunning = useRef(false);

    const [searchQuery, setSearchQuery] = useState("");
    const [searchData, setSearchData] = useState(null);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState(null);
    const [searchSeasonFetchDone, setSearchSeasonFetchDone] = useState(false);
    const searchSeasonFetchRunning = useRef(false);

    // Stato per i match extra della search
    const [searchMatchOffset, setSearchMatchOffset] = useState(0);
    const [searchExtraMatches, setSearchExtraMatches] = useState([]);
    const [loadingMoreSearch, setLoadingMoreSearch] = useState(false);

    function extractPlayerData(matchDetail, puuid) {
        const info = matchDetail?.info;
        if (!info) return null;
        const participant = info.participants?.find(p => p.puuid === puuid);
        if (!participant) return null;
        return {
            matchId: matchDetail.metadata?.matchId,
            win: participant.win,
            championName: participant.championName,
            champLevel: participant.champLevel,
            kills: participant.kills,
            deaths: participant.deaths,
            assists: participant.assists,
            totalMinionsKilled: (participant.totalMinionsKilled || 0) + (participant.neutralMinionsKilled || 0),
            gameDuration: info.gameDuration,
            item0: participant.item0,
            item1: participant.item1,
            item2: participant.item2,
            item3: participant.item3,
            item4: participant.item4,
            item5: participant.item5,
            item6: participant.item6,
            visionScore: participant.visionScore,
            goldEarned: participant.goldEarned,
            queueLabel: info.gameMode,
            gameCreation: info.gameCreation,
        };
    }

    const SEASON_2026_START = new Date("2026-01-08T00:00:00Z").getTime();
    const BATCH_DELAY_MS = 2500;
    const SEASON_FETCH_LIMIT = 20; // max partite da scaricare automaticamente all'avvio

    async function runSeasonFetch({ puuid, startOffset, setMatches, setOffset, setDone, runningRef }) {
        if (runningRef.current) return;
        runningRef.current = true;

        let offset = startOffset;
        let fetched = 0;
        let keepGoing = true;

        while (keepGoing && runningRef.current && fetched < SEASON_FETCH_LIMIT) {
            try {
                const more = await invoke("get_more_matches", { puuid, start: offset });

                if (!more || more.length === 0) break;

                const extracted = more
                    .map(m => extractPlayerData(m, puuid))
                    .filter(Boolean);

                const oldestInBatch = extracted.reduce((min, m) =>
                    m.gameCreation && m.gameCreation < min ? m.gameCreation : min, Infinity
                );

                if (oldestInBatch < SEASON_2026_START) {
                    const seasonOnly = extracted.filter(m => !m.gameCreation || m.gameCreation >= SEASON_2026_START);
                    if (seasonOnly.length > 0) {
                        setMatches(prev => {
                            const ids = new Set(prev.map(m => m.matchId));
                            return [...prev, ...seasonOnly.filter(m => !ids.has(m.matchId))];
                        });
                        fetched += seasonOnly.length;
                    }
                    keepGoing = false;
                } else {
                    setMatches(prev => {
                        const ids = new Set(prev.map(m => m.matchId));
                        return [...prev, ...extracted.filter(m => !ids.has(m.matchId))];
                    });
                    fetched += extracted.length;
                    offset += more.length;
                    if (setOffset) setOffset(offset);
                }

                await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
            } catch (e) {
                const msg = String(e).toLowerCase();
                if (msg.includes("429") || msg.includes("rate limit")) {
                    console.warn("Rate limit Riot, attendo 12s...");
                    await new Promise(r => setTimeout(r, 12000));
                } else {
                    console.error("Errore fetch season:", e);
                    break;
                }
            }
        }

        runningRef.current = false;
        setDone(true);
    }

    function fetchSeasonMatches(puuid, startOffset) {
        return runSeasonFetch({
            puuid, startOffset,
            setMatches: setAllMatches,
            setOffset: setMatchOffset,
            setDone: setSeasonFetchDone,
            runningRef: seasonFetchRunning,
        });
    }

    async function fetchData() {
        try {
            const res = await invoke("get_profiles");
            setProfileData(res);
            setError(null);

            if (res?.matches && !matchesInitialized.current) {
                const extracted = res.matches
                    .map(m => extractPlayerData(m, res.puuid))
                    .filter(Boolean);
                setAllMatches(extracted);
                const initialOffset = res.matches.length;
                setMatchOffset(initialOffset);
                matchesInitialized.current = true;

                // Avvia fetch automatico di tutta la season in background
                fetchSeasonMatches(res.puuid, initialOffset);
            }
        } catch (err) {
            console.warn("Chiamata fallita:", err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, []);

    async function loadMoreMatches() {
        if (!profileData?.puuid) return;
        setLoadingMore(true);
        try {
            const more = await invoke("get_more_matches", {
                puuid: profileData.puuid,
                start: matchOffset,
            });
            const extracted = more
                .map(m => extractPlayerData(m, profileData.puuid))
                .filter(Boolean);
            setAllMatches(prev => [...prev, ...extracted]);
            setMatchOffset(prev => prev + more.length);
        } catch (e) {
            console.error("Errore carica altri:", e);
        } finally {
            setLoadingMore(false);
        }
    }

    async function loadMoreSearchMatches() {
        if (!searchData?.puuid) return;
        setLoadingMoreSearch(true);
        try {
            const offset = searchMatchOffset === 0 ? 10 : searchMatchOffset;
            const more = await invoke("get_more_matches", {
                puuid: searchData.puuid,
                start: offset,
            });
            const extracted = more
                .map(m => extractPlayerData(m, searchData.puuid))
                .filter(Boolean);
            setSearchExtraMatches(prev => [...prev, ...extracted]);
            setSearchMatchOffset(offset + more.length);
        } catch (e) {
            console.error("Errore carica altri search:", e);
        } finally {
            setLoadingMoreSearch(false);
        }
    }

    function fetchSeasonMatchesForSearch(puuid) {
        return runSeasonFetch({
            puuid, startOffset: 10,
            setMatches: setSearchExtraMatches,
            setOffset: null,
            setDone: setSearchSeasonFetchDone,
            runningRef: searchSeasonFetchRunning,
        });
    }

    async function handleSearch(e) {
        if (e.key !== "Enter" && e.type !== "click") return;
        const parts = searchQuery.trim().split("#");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
            setSearchError("Formato corretto: NomeSummoner#TAG (es. lolllita#kitty)");
            return;
        }
        setSearching(true);
        setSearchError(null);
        setSearchExtraMatches([]);
        setSearchMatchOffset(0);
        setSearchSeasonFetchDone(false);
        searchSeasonFetchRunning.current = false;
        try {
            const res = await invoke("search_summoner", {
                gameName: parts[0],
                tagLine: parts[1],
            });
            setSearchData(res);
            // Avvia fetch automatico season in background
            fetchSeasonMatchesForSearch(res.puuid);
        } catch (err) {
            setSearchError(String(err));
            setSearchData(null);
        } finally {
            setSearching(false);
        }
    }

    function clearSearch() {
        setSearchData(null);
        setSearchQuery("");
        setSearchError(null);
        setSearchExtraMatches([]);
        setSearchMatchOffset(0);
        setSearchSeasonFetchDone(false);
        searchSeasonFetchRunning.current = false;
    }

    function mapRanked(ranked, queueType) {
        if (!ranked) return null;
        const queue = ranked.queueMap?.[queueType];
        if (!queue || !queue.tier || queue.tier === "" || queue.division === "NA") return null;
        return {
            tier: queue.tier,
            rank: queue.division,
            leaguePoints: queue.leaguePoints,
            wins: queue.wins,
            losses: queue.losses,
        };
    }

    function mapRankedFromEntries(entries, queueType) {
        if (!entries || !Array.isArray(entries)) return null;
        const queue = entries.find(e => e.queueType === queueType);
        if (!queue) return null;
        return {
            tier: queue.tier,
            rank: queue.rank,
            leaguePoints: queue.leaguePoints,
            wins: queue.wins,
            losses: queue.losses,
        };
    }

    const rankedSolo = profileData ? mapRanked(profileData.ranked, "RANKED_SOLO_5x5") : null;
    const rankedFlex = profileData ? mapRanked(profileData.ranked, "RANKED_FLEX_SR") : null;

    const searchMatches = [
        ...(searchData?.matches?.map(m => extractPlayerData(m, searchData.puuid))?.filter(Boolean) || []),
        ...searchExtraMatches,
    ];
    const searchRankedSolo = searchData ? mapRankedFromEntries(searchData.ranked_entries, "RANKED_SOLO_5x5") : null;
    const searchRankedFlex = searchData ? mapRankedFromEntries(searchData.ranked_entries, "RANKED_FLEX_SR") : null;

    const activeMatches = searchData ? searchMatches : allMatches;
    const activeProfile = searchData ? searchData.profile : profileData?.profile;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
            {/* Header */}
            <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                                <span className="text-white font-bold text-xl">LoL</span>
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-white">League Stats</h1>
                                <p className="text-xs text-slate-400">Statistics & Analytics</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="relative hidden md:block">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <Input
                                    placeholder="NomeSummoner#TAG"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    onKeyDown={handleSearch}
                                    className="pl-10 w-64 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                                />
                            </div>
                            <Button
                                onClick={handleSearch}
                                disabled={searching}
                                className="bg-blue-600 hover:bg-blue-700 text-white"
                            >
                                {searching ? "..." : "Search"}
                            </Button>
                            {searchData && (
                                <Button
                                    onClick={clearSearch}
                                    className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-3"
                                >
                                    ✕ Il tuo profilo
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {/* Banner summoner cercato */}
            {searchData && (
                <div className="max-w-7xl mx-auto px-4 mt-4">
                    <div className="p-3 bg-blue-900/50 border border-blue-700 text-blue-200 rounded-lg text-sm flex items-center justify-between">
                        <span>
                            Stai visualizzando il profilo di{" "}
                            <strong>{searchData.profile?.gameName}#{searchData.profile?.tagLine}</strong>
                        </span>
                        <button onClick={clearSearch} className="text-blue-400 hover:text-white text-xs underline">
                            Torna al tuo profilo
                        </button>
                    </div>
                </div>
            )}

            {/* Errore search */}
            {searchError && (
                <div className="max-w-7xl mx-auto px-4 mt-4">
                    <div className="p-3 bg-red-900/50 border border-red-700 text-red-200 rounded-lg text-sm">
                        {searchError}
                    </div>
                </div>
            )}

            {/* Errori profilo */}
            {!searchData && error === "CLIENT_CLOSED" && (
                <div className="max-w-7xl mx-auto px-4 mt-4">
                    <div className="p-4 bg-yellow-600 text-white rounded-lg shadow-lg">
                        <strong>Client non rilevato:</strong> Apri League of Legends per vedere i dati aggiornati.
                    </div>
                </div>
            )}
            {!searchData && error && error !== "CLIENT_CLOSED" && (
                <div className="max-w-7xl mx-auto px-4 mt-4">
                    <div className="p-4 bg-red-800 text-white rounded-lg">
                        Errore: {String(error)}
                    </div>
                </div>
            )}

            {/* Main */}
            <main className="max-w-7xl mx-auto px-4 py-8">
                <Tabs defaultValue="profile" className="space-y-6">
                    <TabsList className="bg-slate-900 border border-slate-800 p-1">
                        <TabsTrigger
                            value="profile"
                            className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                        >
                            <User className="w-4 h-4 mr-2" />
                            Profile
                        </TabsTrigger>
                        <TabsTrigger
                            value="matches"
                            className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                        >
                            <History className="w-4 h-4 mr-2" />
                            Match History
                        </TabsTrigger>
                        <TabsTrigger
                            value="meta"
                            className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                        >
                            <TrendingUp className="w-4 h-4 mr-2" />
                            Champion Stats
                        </TabsTrigger>
                        <TabsTrigger
                            value="tier-list"
                            className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                        >
                            <BarChart2 className="w-4 h-4 mr-2" />
                            Tier List
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="profile">
                        {searchData ? (
                            <ProfileTab
                                profile={searchData.profile}
                                rankedSolo={searchRankedSolo}
                                rankedFlex={searchRankedFlex}
                                matches={searchMatches}
                            />
                        ) : profileData ? (
                            <ProfileTab
                                profile={profileData.profile}
                                rankedSolo={rankedSolo}
                                rankedFlex={rankedFlex}
                                matches={allMatches}
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64">
                                {loading ? (
                                    <p className="text-slate-400 animate-pulse">Inizializzazione in corso...</p>
                                ) : (
                                    <p className="text-slate-500">In attesa del client di gioco...</p>
                                )}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="matches">
                        {searchData ? (
                            <div className="space-y-4">
                                <MatchHistoryTab matches={searchMatches} />
                                <div className="flex justify-center pt-2 pb-6">
                                    <Button
                                        onClick={loadMoreSearchMatches}
                                        disabled={loadingMoreSearch}
                                        className="bg-slate-700 hover:bg-slate-600 text-white px-10"
                                    >
                                        {loadingMoreSearch ? "Caricamento..." : "Carica altri 5"}
                                    </Button>
                                </div>
                            </div>
                        ) : profileData ? (
                            <div className="space-y-4">
                                <MatchHistoryTab matches={allMatches} />
                                <div className="flex justify-center pt-2 pb-6">
                                    <Button
                                        onClick={loadMoreMatches}
                                        disabled={loadingMore}
                                        className="bg-slate-700 hover:bg-slate-600 text-white px-10"
                                    >
                                        {loadingMore ? "Caricamento..." : "Carica altri 5"}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-64">
                                {loading ? (
                                    <p className="text-slate-400 animate-pulse">Caricamento partite...</p>
                                ) : (
                                    <p className="text-slate-500">In attesa del client di gioco...</p>
                                )}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="meta">
                        <ChampionMetaTab
                            matches={activeMatches}
                            profile={activeProfile}
                            seasonFetchDone={searchData ? searchSeasonFetchDone : seasonFetchDone}
                        />
                    </TabsContent>

                    <TabsContent value="tier-list">
                        <MetaTab />
                    </TabsContent>

                </Tabs>
            </main>

            {/* Footer */}
            <footer className="border-t border-slate-800 bg-slate-900/50 backdrop-blur-sm mt-16">
                <div className="max-w-7xl mx-auto px-4 py-6">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <p className="text-slate-400 text-sm">
                            League Stats isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games.
                        </p>
                        <p className="text-slate-500 text-xs">Patch 14.4 • Updated 2 hours ago</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}