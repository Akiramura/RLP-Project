import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ProfileTab } from "./components/profile-tab";
import { MatchHistoryTab } from "./components/match-history-tab";
import { ChampionMetaTab } from "./components/champion-meta-tab";
import { MetaTab } from "./components/meta-tab";
import { MasteriesTab } from "./components/masteries-tab";
import { User, History, TrendingUp, Search, BarChart2, Swords, Tv, Star, Download, X, RefreshCw, CheckCircle2 } from "lucide-react";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import "./App.css";

import { ChampSelectTab } from "./components/champ-select-tab";
import { LiveGameTab } from "./components/live-game-tab";
import { UpdateBanner } from "./components/ui/UpdateBanner";

export default function App() {
    const [updateInfo, setUpdateInfo] = useState(null);
    const [updateStatus, setUpdateStatus] = useState("idle");
    const [updateProgress, setUpdateProgress] = useState(0);
    const updateRef = useRef(null);
    const [profileData, setProfileData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [allMatches, setAllMatches] = useState([]);
    const [matchOffset, setMatchOffset] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);
    const matchesInitialized = useRef(false);
    const lastLoadedPuuid = useRef(null);
    const latestMatchId = useRef(null);
    const seenMatchIds = useRef(new Set());        // dedup esterno per profilo principale
    const seenSearchMatchIds = useRef(new Set());  // dedup esterno per search

    const [seasonFetchDone, setSeasonFetchDone] = useState(false);
    const seasonFetchRunning = useRef(false);

    const [searchQuery, setSearchQuery] = useState("");
    const [searchData, setSearchData] = useState(null);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState(null);
    const [searchSeasonFetchDone, setSearchSeasonFetchDone] = useState(false);
    const searchSeasonFetchRunning = useRef(false);

    // ── Cronologia ricerche + suggerimenti live ──────────────────────────────
    const HISTORY_KEY = "rlp_search_history";
    const MAX_HISTORY = 5;
    // Ogni entry: { name, tag, profileIconId, tier, rank, lp }
    const [searchHistory, setSearchHistory] = useState(() => {
        try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
        catch { return []; }
    });
    const [showDropdown, setShowDropdown] = useState(false);
    const searchWrapperRef = useRef(null);
    const debounceRef = useRef(null);
    // Suggerimenti live dalla Riot API mentre si digita (come OP.GG)
    const [liveSuggestions, setLiveSuggestions] = useState([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);

    // Chiudi dropdown se si clicca fuori
    useEffect(() => {
        function onClickOutside(e) {
            if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target)) {
                setShowDropdown(false);
            }
        }
        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, []);

    function saveHistory(entry) {
        const key = `${entry.name}#${entry.tag}`.toLowerCase();
        setSearchHistory(prev => {
            const next = [
                entry,
                ...prev.filter(e => `${e.name}#${e.tag}`.toLowerCase() !== key)
            ].slice(0, MAX_HISTORY);
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { }
            return next;
        });
    }

    function removeFromHistory(entry, e) {
        e.stopPropagation();
        const key = `${entry.name}#${entry.tag}`.toLowerCase();
        setSearchHistory(prev => {
            const next = prev.filter(e => `${e.name}#${e.tag}`.toLowerCase() !== key);
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { }
            return next;
        });
    }

    // Filtra la cronologia in base a ciò che si sta digitando
    const filteredHistory = searchQuery.trim().length > 0
        ? searchHistory.filter(h =>
            `${h.name}#${h.tag}`.toLowerCase().includes(searchQuery.trim().toLowerCase())
        )
        : searchHistory;

    // Suggestions da mostrare: se c'è input mostra live (se disponibili) + history filtrata
    // Se nessun input mostra solo history recenti
    const dropdownItems = searchQuery.trim().length > 0
        ? [
            ...liveSuggestions.map(s => ({ ...s, _live: true })),
            ...filteredHistory.filter(h =>
                !liveSuggestions.some(s => `${s.name}#${s.tag}`.toLowerCase() === `${h.name}#${h.tag}`.toLowerCase())
            )
        ]
        : filteredHistory;

    // Suggerimenti live: debounce 400ms, chiama invoke("search_summoner_suggestions") se disponibile,
    // altrimenti usa solo la cronologia filtrata
    function onSearchInput(val) {
        setSearchQuery(val);
        setShowDropdown(true);
        clearTimeout(debounceRef.current);
        if (!val.trim() || val.trim().length < 2) {
            setLiveSuggestions([]);
            return;
        }
        debounceRef.current = setTimeout(async () => {
            // Tenta di chiamare un comando Tauri per suggerimenti live
            // Se non disponibile, usa solo la history
            try {
                setLoadingSuggestions(true);
                const res = await invoke("search_summoner_suggestions", { query: val.trim() });
                if (Array.isArray(res)) setLiveSuggestions(res.slice(0, 5));
            } catch {
                // Comando non disponibile: nessun problema, usiamo solo history
                setLiveSuggestions([]);
            } finally {
                setLoadingSuggestions(false);
            }
        }, 400);
    }

    // Stato per i match extra della search
    const [searchMatchOffset, setSearchMatchOffset] = useState(0);
    const [searchExtraMatches, setSearchExtraMatches] = useState([]);
    const [loadingMoreSearch, setLoadingMoreSearch] = useState(false);

    const [activeTab, setActiveTab] = useState("profile");
    const [isInChampSelect, setIsInChampSelect] = useState(false);
    const [liveMetaData, setLiveMetaData] = useState({});
    const [liveGamePuuid, setLiveGamePuuid] = useState(null); // puuid del profilo attivo per LiveGameTab
    // Ref per accedere al puuid più aggiornato dentro handleTabChange senza dipendenze
    const liveGamePuuidRef = useRef(null);
    const [isInLiveGame, setIsInLiveGame] = useState(false); // profilo attivo in partita live?
    const champSelectPollRef = useRef(null);
    const liveGamePollRef = useRef(null);
    const wasInChampSelect = useRef(false);

    // Redirect away from champ-select tab if it shouldn't be visible
    useEffect(() => {
        if (activeTab === "champ-select" && (searchData || !profileData)) {
            setActiveTab("profile");
        }
    }, [searchData, profileData, activeTab]);

    // Poll champ select to auto-switch tab when a game lobby starts
    useEffect(() => {
        async function checkChampSelect() {
            try {
                const session = await invoke("get_champ_select_session");
                const inProgress = session?.in_progress === true;
                if (inProgress && !wasInChampSelect.current) {
                    // Champ select just started → automatically switch to Auto Import tab
                    setActiveTab("champ-select");
                }
                wasInChampSelect.current = inProgress;
                setIsInChampSelect(inProgress);
            } catch {
                // Client not available or not in champ select, ignore silently
                wasInChampSelect.current = false;
                setIsInChampSelect(false);
            }
        }
        champSelectPollRef.current = setInterval(checkChampSelect, 3000);
        checkChampSelect();
        return () => clearInterval(champSelectPollRef.current);
    }, []);

    // Sincronizza liveGamePuuid quando cambia il profilo attivo (es. clearSearch o nuovo profilo caricato)
    // ma SOLO se la live-game tab è quella attiva, per non disturbare le altre tab
    useEffect(() => {
        if (activeTab === "live-game") {
            const activePuuid = searchData?.puuid ?? profileData?.puuid ?? null;
            if (activePuuid !== liveGamePuuidRef.current) {
                liveGamePuuidRef.current = activePuuid;
                setLiveGamePuuid(activePuuid);
            }
        }
    }, [searchData?.puuid, profileData?.puuid, activeTab]);

    // Poll live game status per mostrare indicatore visivo su tab e pulsante
    useEffect(() => {
        async function checkLiveGame() {
            const activePuuid = searchData?.puuid ?? profileData?.puuid ?? null;
            if (!activePuuid) { setIsInLiveGame(false); return; }
            try {
                const res = await invoke("check_live_game", { puuid: activePuuid });
                setIsInLiveGame(res?.in_game === true);
            } catch {
                setIsInLiveGame(false);
            }
        }
        clearInterval(liveGamePollRef.current);
        checkLiveGame();
        liveGamePollRef.current = setInterval(checkLiveGame, 30000);
        return () => clearInterval(liveGamePollRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profileData?.puuid, searchData?.puuid]);

    // Gestisce sia il formato Riot API (matchDetail + puuid) che il formato RLP (oggetto già normalizzato)
    function extractPlayerData(matchDetail, puuid) {
        // Formato RLP: già normalizzato da get_rlp_matches, ha championName direttamente
        if (matchDetail?.championName !== undefined && matchDetail?.kills !== undefined) {
            return matchDetail;
        }
        // Formato Riot API: ha info.participants[]
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
            items: [participant.item0, participant.item1, participant.item2,
            participant.item3, participant.item4, participant.item5, participant.item6],
            item0: participant.item0, item1: participant.item1, item2: participant.item2,
            item3: participant.item3, item4: participant.item4, item5: participant.item5, item6: participant.item6,
            visionScore: participant.visionScore,
            goldEarned: participant.goldEarned,
            queueLabel: info.gameMode,
            gameCreation: info.gameCreation,
        };
    }

    const SEASON_2026_START = new Date("2026-01-08T00:00:00Z").getTime();

    async function runSeasonFetch({ puuid, startOffset, setMatches, setOffset, setDone, runningRef, seenIds }) {
        if (runningRef.current) return;
        runningRef.current = true;

        let offset = startOffset;
        let fetched = 0;

        while (runningRef.current && fetched < 200) {
            try {
                const more = await invoke("get_more_matches", { puuid, start: offset });

                // more.length === 0 significa che Riot API non ha più match → fine
                if (!more || more.length === 0) break;

                const rawMatches = more.filter(m => m?.metadata || m?.info);

                // Dedup usando il set esterno (immune da race condition React state)
                const newMatches = rawMatches.filter(m => {
                    const id = m?.metadata?.matchId ?? m?.matchId;
                    if (!id || seenIds.current.has(id)) return false;
                    seenIds.current.add(id);
                    return true;
                });

                if (newMatches.length > 0) {
                    setMatches(prev => [...prev, ...newMatches]);
                    fetched += newMatches.length;
                }

                // L'offset va avanzato di 10 (quanti ne chiede get_more_matches a Riot)
                offset += 10;
                if (setOffset) setOffset(offset);

                // Se Riot ha restituito meno di 10 match, siamo alla fine della season
                if (more.length < 10) break;

                await new Promise(r => setTimeout(r, 3000));
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
            seenIds: seenMatchIds,
        });
    }

    async function fetchData() {
        try {
            const res = await invoke("get_profiles");
            setProfileData(res);
            setError(null);

            const isNewPlayer = !matchesInitialized.current || lastLoadedPuuid.current !== res.puuid;

            if (isNewPlayer) {
                // Prima inizializzazione o cambio account
                matchesInitialized.current = true;
                lastLoadedPuuid.current = res.puuid;
                seasonFetchRunning.current = false;
                setSeasonFetchDone(false);

                // Riot API — conserva i match raw (con info.participants)
                if (res?.matches) {
                    const filtered = res.matches.filter(m => m?.metadata || m?.info);
                    // Popola il set di dedup con i match già caricati
                    seenMatchIds.current = new Set(
                        filtered.map(m => m?.metadata?.matchId ?? m?.matchId).filter(Boolean)
                    );
                    setAllMatches(filtered);
                    const initialOffset = 20;
                    setMatchOffset(initialOffset);
                    latestMatchId.current = filtered[0]?.metadata?.matchId ?? null;
                    fetchSeasonMatches(res.puuid, initialOffset);
                }

            } else {
                // Polling periodico: controlla se ci sono nuove partite via Riot API
                // Salta se il season fetch è ancora in corso (evita rate limit)
                if (seasonFetchRunning.current) {
                    console.log("[Refresh] Season fetch in corso, salto check nuove partite.");
                    return;
                }
                try {
                    const more = await invoke("get_more_matches", {
                        puuid: res.puuid,
                        start: 0,
                    });
                    const fresh = more?.filter(m => m?.metadata || m?.info) ?? [];
                    if (fresh.length > 0) {
                        const newestId = fresh[0]?.metadata?.matchId;
                        if (newestId && newestId !== latestMatchId.current) {
                            console.log("[Refresh] Nuova partita rilevata:", newestId);
                            latestMatchId.current = newestId;
                            setAllMatches(prev => {
                                const existingIds = new Set(prev.map(m => m?.metadata?.matchId ?? m?.matchId));
                                const newOnes = fresh.filter(m => {
                                    const id = m?.metadata?.matchId;
                                    return id && !existingIds.has(id);
                                });
                                return newOnes.length > 0 ? [...newOnes, ...prev] : prev;
                            });
                        }
                    }
                } catch (riotErr) {
                    console.warn("[Refresh] Impossibile controllare nuove partite:", riotErr);
                }
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
        const interval = setInterval(fetchData, 60000); // 60s — evita rate limit durante season fetch
        return () => clearInterval(interval);
    }, []);

    // ── Auto-updater ──────────────────────────────────────────────
    useEffect(() => {
        async function checkForUpdates() {
            try {
                const update = await check();
                if (update?.available) {
                    updateRef.current = update;
                    setUpdateInfo({ version: update.version, body: update.body ?? "" });
                    setUpdateStatus("available");
                } else {
                    console.log("[Updater] Nessun aggiornamento disponibile. Versione attuale:", update);
                }
            } catch (e) {
                console.error("[Updater] Errore:", e);
            }
        }
        checkForUpdates();
    }, []);

    async function handleUpdate() {
        if (!updateRef.current) return;
        setUpdateStatus("downloading");
        setUpdateProgress(0);
        try {
            await updateRef.current.downloadAndInstall((event) => {
                if (event.event === "Started") {
                    setUpdateProgress(0);
                } else if (event.event === "Progress") {
                    const { chunkLength, contentLength } = event.data;
                    if (contentLength) {
                        setUpdateProgress(prev => Math.min(100, prev + (chunkLength / contentLength) * 100));
                    }
                } else if (event.event === "Finished") {
                    setUpdateProgress(100);
                    setUpdateStatus("done");
                    setTimeout(() => relaunch(), 1500);
                }
            });
        } catch (e) {
            console.error("[Updater] Errore download:", e);
            setUpdateStatus("available");
        }
    }

    function handleDismissUpdate() {
        setUpdateStatus("idle");
        setUpdateInfo(null);
    }

    async function loadMoreMatches() {
        if (!profileData?.puuid) return;
        setLoadingMore(true);
        try {
            const more = await invoke("get_more_matches", {
                puuid: profileData.puuid,
                start: matchOffset,
            });
            const raw = more.filter(m => m?.metadata || m?.info);
            const newMatches = raw.filter(m => {
                const id = m?.metadata?.matchId ?? m?.matchId;
                if (!id || seenMatchIds.current.has(id)) return false;
                seenMatchIds.current.add(id);
                return true;
            });
            if (newMatches.length > 0) setAllMatches(prev => [...prev, ...newMatches]);
            setMatchOffset(prev => prev + 10);
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
            const offset = searchMatchOffset === 0 ? 20 : searchMatchOffset;
            const more = await invoke("get_more_matches", {
                puuid: searchData.puuid,
                start: offset,
            });
            const raw = more.filter(m => m?.metadata || m?.info);
            const newMatches = raw.filter(m => {
                const id = m?.metadata?.matchId ?? m?.matchId;
                if (!id || seenSearchMatchIds.current.has(id)) return false;
                seenSearchMatchIds.current.add(id);
                return true;
            });
            if (newMatches.length > 0) setSearchExtraMatches(prev => [...prev, ...newMatches]);
            setSearchMatchOffset(offset + 10);
        } catch (e) {
            console.error("Errore carica altri search:", e);
        } finally {
            setLoadingMoreSearch(false);
        }
    }

    function fetchSeasonMatchesForSearch(puuid) {
        return runSeasonFetch({
            puuid, startOffset: 20, // search_summoner fetcha 20, partiamo da 20
            setMatches: setSearchExtraMatches,
            setOffset: null,
            setDone: setSearchSeasonFetchDone,
            runningRef: searchSeasonFetchRunning,
            seenIds: seenSearchMatchIds,
        });
    }

    async function doSearch(gameName, tagLine) {
        setSearching(true);
        setSearchError(null);
        setSearchExtraMatches([]);
        setSearchMatchOffset(0);
        setSearchSeasonFetchDone(false);
        searchSeasonFetchRunning.current = false;
        setShowDropdown(false);
        setLiveSuggestions([]);
        try {
            const res = await invoke("search_summoner", { gameName: gameName.trim(), tagLine: tagLine.trim() });
            setSearchData(res);

            // Salva in cronologia con icona e rank
            const soloEntry = res?.ranked_entries?.find(e => e.queueType === "RANKED_SOLO_5x5");
            saveHistory({
                name: res?.profile?.gameName ?? gameName.trim(),
                tag: res?.profile?.tagLine ?? tagLine.trim(),
                profileIconId: res?.profile?.profileIconId ?? null,
                tier: soloEntry?.tier ?? "",
                rank: soloEntry?.rank ?? soloEntry?.division ?? "",
                lp: soloEntry?.leaguePoints ?? 0,
            });

            // Popola seenSearchMatchIds con i match già caricati da search_summoner
            const initialMatches = res?.matches?.filter(m => m?.metadata || m?.info) || [];
            seenSearchMatchIds.current = new Set(
                initialMatches.map(m => m?.metadata?.matchId ?? m?.matchId).filter(Boolean)
            );

            // Usa Riot API season fetch
            fetchSeasonMatchesForSearch(res.puuid);
        } catch (err) {
            console.error("[RLP search] Error:", err);
            setSearchData(null);
        } finally {
            setSearching(false);
        }
    }

    async function handleSearch(e) {
        if (e.key !== "Enter" && e.type !== "click") return;
        const parts = searchQuery.trim().split("#");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
            console.warn("[RLP] Formato non valido: NomeSummoner#TAG");
            return;
        }
        setActiveTab("profile");
        await doSearch(parts[0], parts[1]);
    }

    async function handlePlayerClick(summonerId) {
        const parts = summonerId.trim().split("#");
        if (parts.length !== 2 || !parts[0] || !parts[1]) return;
        setSearchQuery(summonerId);
        setActiveTab("profile");
        await doSearch(parts[0], parts[1]);
    }

    function handleViewLiveGame(puuid) {
        const target = puuid || null;
        liveGamePuuidRef.current = target;
        setLiveGamePuuid(target);
        setActiveTab("live-game");
    }

    function handleTabChange(tab) {
        if (tab === "live-game") {
            // Usa il puuid del profilo attualmente visualizzato (search o proprio)
            const activePuuid = searchData?.puuid ?? myPuuid ?? null;
            liveGamePuuidRef.current = activePuuid;
            setLiveGamePuuid(activePuuid);
        }
        setActiveTab(tab);
    }

    function clearSearch() {
        // Aggiorna il puuid della live game tab al proprio profilo prima di pulire la ricerca
        const ownPuuid = profileData?.puuid ?? null;
        liveGamePuuidRef.current = ownPuuid;
        setLiveGamePuuid(ownPuuid);

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

        // Formato 1: queueMap è un oggetto keyed per queueType
        // Formato 2: queues è un array (risposta LCU /lol-ranked/v1/current-ranked-stats)
        let queue = ranked.queueMap?.[queueType]
            ?? ranked.queues?.find(q => q.queueType === queueType);

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

    const myPuuid = profileData?.puuid ?? null;
    const mySummonerName = profileData?.profile?.gameName
        ? `${profileData.profile.gameName}#${profileData.profile.tagLine}`
        : null;

    const searchMatches = [
        ...(searchData?.matches?.filter(m => m?.metadata || m?.info) || []),
        ...searchExtraMatches,
    ];
    const searchRankedSolo = searchData ? mapRankedFromEntries(searchData.ranked_entries, "RANKED_SOLO_5x5") : null;
    const searchRankedFlex = searchData ? mapRankedFromEntries(searchData.ranked_entries, "RANKED_FLEX_SR") : null;

    const activeMatches = searchData ? searchMatches : allMatches;
    const activeProfile = searchData ? searchData.profile : profileData?.profile;

    return (
        <div className="min-h-screen bg-gradient-to-br from-[#040c1a] via-[#070f1e] to-[#040c1a]">
            {/* Header */}
            <header className="border-b border-[#0f2040] bg-[#070f1e]/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <img
                                src="/RLP Icon.png"
                                alt="RLP Logo"
                                className="w-16 h-16 rounded-xl object-cover"
                                onError={e => { e.target.src = "/RLP_Icon.png"; }}
                            />
                            <div>
                                <h1 className="text-xl font-bold text-white">Raise League Power</h1>
                                <p className="text-xs text-[#5a8ab0]">Statistics & Analytics</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            {/* Search con dropdown cronologia + suggerimenti live */}
                            <div className="relative hidden md:block" ref={searchWrapperRef}>
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a8ab0] pointer-events-none z-10" />
                                <Input
                                    placeholder="Nome Summoner#TAG"
                                    value={searchQuery}
                                    onChange={e => onSearchInput(e.target.value)}
                                    onFocus={() => setShowDropdown(true)}
                                    onKeyDown={e => {
                                        if (e.key === "Escape") { setShowDropdown(false); return; }
                                        handleSearch(e);
                                    }}
                                    className="pl-10 w-72 bg-[#0d1f38] border-[#1a3558] text-white placeholder:text-[#3a6080] focus:border-[#1e6fff] transition-colors"
                                />
                                {/* Dropdown */}
                                {showDropdown && (dropdownItems.length > 0 || loadingSuggestions) && (
                                    <div className="absolute top-full left-0 mt-1.5 w-full bg-[#08162b] border border-[#1a3558] rounded-xl shadow-2xl z-50 overflow-hidden">
                                        {/* Header dropdown */}
                                        <div className="flex items-center justify-between px-3 pt-2 pb-1 border-b border-[#0f2040]">
                                            <span className="text-[#3a6080] text-[12px] font-bold uppercase tracking-widest">
                                                {searchQuery.trim().length > 0 ? "Risultati" : "Recenti"}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                {loadingSuggestions && (
                                                    <span className="text-[#3a6080] text-[12px]">...</span>
                                                )}
                                                {searchHistory.length > 0 && !searchQuery.trim() && (
                                                    <button
                                                        onClick={() => {
                                                            setSearchHistory([]);
                                                            try { localStorage.removeItem(HISTORY_KEY); } catch { }
                                                        }}
                                                        className="text-[#2a5070] hover:text-red-400 text-[12px] transition-colors"
                                                    >
                                                        Cancella
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Items */}
                                        {dropdownItems.map((entry, i) => {
                                            const PATCH_LOCAL = "16.4.1";
                                            const tierColor = {
                                                IRON: "text-[#8ab0cc]", BRONZE: "text-amber-600",
                                                SILVER: "text-[#9ab8d0]", GOLD: "text-yellow-400",
                                                PLATINUM: "text-teal-400", EMERALD: "text-emerald-400",
                                                DIAMOND: "text-[#4fc3f7]", MASTER: "text-purple-400",
                                                GRANDMASTER: "text-red-400", CHALLENGER: "text-yellow-300",
                                            }[entry.tier?.toUpperCase()] ?? "text-[#5a8ab0]";
                                            const tierLabel = entry.tier
                                                ? `${entry.tier.charAt(0).toUpperCase()}${entry.tier.slice(1).toLowerCase()}${!["MASTER", "GRANDMASTER", "CHALLENGER"].includes(entry.tier?.toUpperCase()) && entry.rank ? ` ${entry.rank}` : ""}`
                                                : null;

                                            return (
                                                <div
                                                    key={i}
                                                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#0d1f38] cursor-pointer group transition-colors"
                                                    onClick={() => {
                                                        const q = `${entry.name}#${entry.tag}`;
                                                        setSearchQuery(q);
                                                        setShowDropdown(false);
                                                        setActiveTab("profile");
                                                        doSearch(entry.name, entry.tag);
                                                    }}
                                                >
                                                    {/* Avatar */}
                                                    <div className="relative shrink-0">
                                                        {entry.profileIconId ? (
                                                            <img
                                                                src={`https://ddragon.leagueoflegends.com/cdn/${PATCH_LOCAL}/img/profileicon/${entry.profileIconId}.png`}
                                                                alt=""
                                                                className="w-7 h-7 rounded-full object-cover border border-[#1a3558]"
                                                                onError={e => { e.target.style.display = "none"; }}
                                                            />
                                                        ) : (
                                                            <div className="w-7 h-7 rounded-full bg-[#142545] border border-[#1a3558] flex items-center justify-center">
                                                                <User className="w-3 h-3 text-[#3a6080]" />
                                                            </div>
                                                        )}
                                                        {entry._live && (
                                                            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#1e6fff] rounded-full border border-[#08162b]" />
                                                        )}
                                                    </div>

                                                    {/* Info */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-white text-sm font-semibold truncate">{entry.name}</span>
                                                            <span className="text-[#3a6080] text-sm shrink-0">#{entry.tag}</span>
                                                        </div>
                                                        {tierLabel ? (
                                                            <span className={`text-[12px] font-medium ${tierColor}`}>
                                                                {tierLabel}{entry.lp > 0 ? ` · ${entry.lp}LP` : ""}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[#3a6080] text-[12px]">Unranked</span>
                                                        )}
                                                    </div>

                                                    {/* Remove (solo history) */}
                                                    {!entry._live && (
                                                        <button
                                                            onClick={e => removeFromHistory(entry, e)}
                                                            className="text-[#2a5070] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0 p-1"
                                                            title="Rimuovi"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <Button
                                onClick={handleSearch}
                                disabled={searching}
                                className="bg-[#1e6fff] hover:bg-[#1459d4] text-white"
                            >
                                {searching ? "..." : "Search"}
                            </Button>
                            {searchData && (
                                <Button
                                    onClick={clearSearch}
                                    className="bg-[#142545] hover:bg-[#1e3560] text-white text-xs px-3"
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
                    <div className="p-3 bg-[#0a1e4a]/50 border border-[#1459d4] text-[#a8e4ff] rounded-lg text-sm flex items-center justify-between">
                        <span>
                            Stai visualizzando il profilo di{" "}
                            <strong>{searchData.profile?.gameName}#{searchData.profile?.tagLine}</strong>
                        </span>
                        <button onClick={clearSearch} className="text-[#4fc3f7] hover:text-white text-xs underline">
                            Torna al tuo profilo
                        </button>
                    </div>
                </div>
            )}

            {/* searchError logged to console only */}

            {/* Errori profilo */}
            {/* Offline mode: dev only — hidden from UI */}
            {/* CLIENT_CLOSED error logged to console only */}

            {/* Main */}
            <main className="max-w-7xl mx-auto px-4 py-8">
                <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
                    <TabsList className="bg-[#070f1e] border border-[#0f2040] p-1 rounded-lg">
                        <TabsTrigger
                            value="profile"
                            className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white"
                        >
                            <User className="w-4 h-4 mr-2" />
                            Profile
                        </TabsTrigger>
                        <TabsTrigger
                            value="matches"
                            className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white"
                        >
                            <History className="w-4 h-4 mr-2" />
                            Match History
                        </TabsTrigger>
                        <TabsTrigger
                            value="masteries"
                            className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white"
                        >
                            <Star className="w-4 h-4 mr-2" />
                            Maestrie
                        </TabsTrigger>
                        <TabsTrigger
                            value="meta"
                            className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white"
                        >
                            <TrendingUp className="w-4 h-4 mr-2" />
                            Champion Stats
                        </TabsTrigger>
                        <TabsTrigger
                            value="tier-list"
                            className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white"
                        >
                            <BarChart2 className="w-4 h-4 mr-2" />
                            Tier List
                        </TabsTrigger>
                        {!searchData && profileData && (
                            <TabsTrigger
                                value="champ-select"
                                className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white relative"
                            >
                                <Swords className="w-4 h-4 mr-2" />
                                Auto Import
                                {isInChampSelect && (
                                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
                                )}
                            </TabsTrigger>
                        )}
                        <TabsTrigger
                            value="live-game"
                            className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white relative"
                        >
                            <Tv className="w-4 h-4 mr-2" />
                            Live Game
                            {isInLiveGame && (
                                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" title="In partita!" />
                            )}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="profile">
                        {searchData ? (
                            <ProfileTab
                                profile={searchData.profile}
                                rankedSolo={searchRankedSolo}
                                rankedFlex={searchRankedFlex}
                                matches={searchMatches}
                                myPuuid={searchData.puuid}
                                mySummonerName={`${searchData.profile?.gameName}#${searchData.profile?.tagLine}`}
                                onViewLiveGame={handleViewLiveGame}
                                isInLiveGame={isInLiveGame}
                            />
                        ) : profileData ? (
                            <ProfileTab
                                profile={profileData.profile}
                                rankedSolo={rankedSolo}
                                rankedFlex={rankedFlex}
                                matches={allMatches}
                                myPuuid={myPuuid}
                                mySummonerName={mySummonerName}
                                onViewLiveGame={handleViewLiveGame}
                                isInLiveGame={isInLiveGame}
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64">
                                {loading ? (
                                    <p className="text-[#5a8ab0] animate-pulse">Inizializzazione in corso...</p>
                                ) : (
                                    <p className="text-[#3a6080]">In attesa del client di gioco...</p>
                                )}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="matches">
                        {searchData ? (
                            <MatchHistoryTab
                                matches={searchMatches}
                                myPuuid={searchData.puuid}
                                mySummonerName={`${searchData.profile?.gameName}#${searchData.profile?.tagLine}`}
                                onPlayerClick={handlePlayerClick}
                            />
                        ) : profileData ? (
                            <MatchHistoryTab
                                matches={allMatches}
                                myPuuid={myPuuid}
                                mySummonerName={mySummonerName}
                                onPlayerClick={handlePlayerClick}
                            />
                        ) : (
                            <div className="flex items-center justify-center h-64">
                                {loading ? (
                                    <p className="text-[#5a8ab0] animate-pulse">Caricamento partite...</p>
                                ) : (
                                    <p className="text-[#3a6080]">In attesa del client di gioco...</p>
                                )}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="masteries">
                        <MasteriesTab
                            puuid={searchData?.puuid ?? myPuuid}
                            profile={activeProfile}
                        />
                    </TabsContent>

                    <TabsContent value="meta">
                        <ChampionMetaTab
                            matches={activeMatches}
                            profile={activeProfile}
                            seasonFetchDone={searchData ? searchSeasonFetchDone : seasonFetchDone}
                            metaData={liveMetaData}
                            myPuuid={searchData ? searchData.puuid : myPuuid}
                            mySummonerName={searchData
                                ? `${searchData.profile?.gameName}#${searchData.profile?.tagLine}`
                                : mySummonerName}
                        />
                    </TabsContent>

                    <TabsContent value="tier-list">
                        <MetaTab onMetaDataReady={setLiveMetaData} />
                    </TabsContent>

                    <TabsContent value="champ-select" keepMounted>
                        <ChampSelectTab />
                    </TabsContent>

                    <TabsContent value="live-game">
                        <LiveGameTab puuidOverride={liveGamePuuid} myPuuid={myPuuid} />
                    </TabsContent>

                </Tabs>
            </main>

            {/* Update Banner */}
            <UpdateBanner
                status={updateStatus}
                info={updateInfo}
                progress={updateProgress}
                onUpdate={handleUpdate}
                onDismiss={handleDismissUpdate}
            />

            {/* Footer */}
            <footer className="border-t border-[#0f2040] bg-[#070f1e]/50 backdrop-blur-sm mt-16">
                <div className="max-w-7xl mx-auto px-4 py-6">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <p className="text-[#5a8ab0] text-sm">
                            RLP isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games.
                        </p>
                        <p className="text-[#3a6080] text-xs">Patch 14.4 • Updated 2 hours ago</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}