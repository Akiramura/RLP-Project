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
import { User, History, TrendingUp, Search, BarChart2, Swords, Tv, Star, X } from "lucide-react";
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

    useEffect(() => {
        window.__fakeUpdate = (version = "9.9.9", body = "Fake update per test UI") => {
            setUpdateInfo({ version, body });
            setUpdateStatus("available");
        };
        window.__fakeDownload = async () => {
            setUpdateStatus("downloading");
            setUpdateProgress(0);
            for (let i = 0; i <= 100; i += 5) {
                await new Promise(r => setTimeout(r, 80));
                setUpdateProgress(i);
            }
            setUpdateStatus("done");
        };
        return () => { delete window.__fakeUpdate; delete window.__fakeDownload; };
    }, []);

    const [profileData, setProfileData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [allMatches, setAllMatches] = useState([]);
    const [loadingMore, setLoadingMore] = useState(false);
    const matchesInitialized = useRef(false);
    const lastLoadedPuuid = useRef(null);
    const latestMatchId = useRef(null);

    const [searchQuery, setSearchQuery] = useState("");
    const [searchData, setSearchData] = useState(null);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState(null);
    const [recentStats, setRecentStats] = useState(null);
    const [searchRecentStats, setSearchRecentStats] = useState(null);

    const HISTORY_KEY = "rlp_search_history";
    const MAX_HISTORY = 5;
    const [searchHistory, setSearchHistory] = useState(() => {
        try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
        catch { return []; }
    });

    const REGION_KEY = "rlp_region";
    const [region, setRegion] = useState(() => {
        try { return localStorage.getItem(REGION_KEY) || "euw"; }
        catch { return "euw"; }
    });
    const regionRef = useRef(region);
    const [regionAutoDetected, setRegionAutoDetected] = useState(false);
    // true quando l'utente ha scelto manualmente la region → blocca l'auto-detect LCU
    const userOverrodeRegion = useRef(false);

    function changeRegion(r) {
        setRegion(r);
        regionRef.current = r;
        userOverrodeRegion.current = true; // l'utente ha scelto manualmente, non fare override
        setRegionAutoDetected(false);
        try { localStorage.setItem(REGION_KEY, r); } catch { }
        setTimeout(() => fetchDataWithRegion(r), 0);
    }

    async function detectRegionFromLCU() {
        // Se l'utente ha cambiato region manualmente, non sovrascrivere
        if (userOverrodeRegion.current) return;
        try {
            const r = await invoke("get_client_region");
            if (r && r !== regionRef.current) {
                setRegion(r);
                regionRef.current = r;
                try { localStorage.setItem(REGION_KEY, r); } catch { }
                setTimeout(() => fetchDataWithRegion(r), 0);
            }
            if (r) setRegionAutoDetected(true);
        } catch { }
    }

    const [showDropdown, setShowDropdown] = useState(false);
    const searchWrapperRef = useRef(null);
    const debounceRef = useRef(null);
    const [liveSuggestions, setLiveSuggestions] = useState([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);

    useEffect(() => {
        function onClickOutside(e) {
            if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target))
                setShowDropdown(false);
        }
        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, []);

    function saveHistory(entry) {
        const key = `${entry.name}#${entry.tag}`.toLowerCase();
        setSearchHistory(prev => {
            const next = [entry, ...prev.filter(e => `${e.name}#${e.tag}`.toLowerCase() !== key)].slice(0, MAX_HISTORY);
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

    const filteredHistory = searchQuery.trim().length > 0
        ? searchHistory.filter(h => `${h.name}#${h.tag}`.toLowerCase().includes(searchQuery.trim().toLowerCase()))
        : searchHistory;

    const dropdownItems = searchQuery.trim().length > 0
        ? [
            ...liveSuggestions.map(s => ({ ...s, _live: true })),
            ...filteredHistory.filter(h => !liveSuggestions.some(s => `${s.name}#${s.tag}`.toLowerCase() === `${h.name}#${h.tag}`.toLowerCase()))
        ]
        : filteredHistory;

    function onSearchInput(val) {
        setSearchQuery(val);
        setShowDropdown(true);
        clearTimeout(debounceRef.current);
        if (!val.trim() || val.trim().length < 2) { setLiveSuggestions([]); return; }
        debounceRef.current = setTimeout(async () => {
            try {
                setLoadingSuggestions(true);
                const res = await invoke("search_summoner_suggestions", { query: val.trim() });
                if (Array.isArray(res)) setLiveSuggestions(res.slice(0, 5));
            } catch { setLiveSuggestions([]); }
            finally { setLoadingSuggestions(false); }
        }, 400);
    }

    const [loadingMoreSearch, setLoadingMoreSearch] = useState(false);
    const [activeTab, setActiveTab] = useState("profile");
    const [isInChampSelect, setIsInChampSelect] = useState(false);
    const [liveMetaData, setLiveMetaData] = useState({});
    const [liveGamePuuid, setLiveGamePuuid] = useState(null);
    const liveGamePuuidRef = useRef(null);
    const [isInLiveGame, setIsInLiveGame] = useState(false);
    const champSelectPollRef = useRef(null);
    const wasInChampSelect = useRef(false);

    useEffect(() => {
        if (activeTab === "champ-select" && (searchData || !profileData)) setActiveTab("profile");
    }, [searchData, profileData, activeTab]);

    useEffect(() => {
        async function checkChampSelect() {
            try {
                const session = await invoke("get_champ_select_session");
                const inProgress = session?.in_progress === true;
                if (inProgress && !wasInChampSelect.current) setActiveTab("champ-select");
                wasInChampSelect.current = inProgress;
                setIsInChampSelect(inProgress);
            } catch { wasInChampSelect.current = false; setIsInChampSelect(false); }
        }
        champSelectPollRef.current = setInterval(checkChampSelect, 5000);
        checkChampSelect();
        return () => clearInterval(champSelectPollRef.current);
    }, []);

    useEffect(() => {
        if (activeTab === "live-game") {
            const activePuuid = searchData?.puuid ?? profileData?.puuid ?? null;
            if (activePuuid !== liveGamePuuidRef.current) {
                liveGamePuuidRef.current = activePuuid;
                setLiveGamePuuid(activePuuid);
            }
        }
    }, [searchData?.puuid, profileData?.puuid, activeTab]);

    const SEASON_2026_START = new Date("2026-01-08T00:00:00Z").getTime();

    function filterSeasonMatches(matches) {
        if (!Array.isArray(matches)) return [];
        return matches.filter(m => {
            if (!m?.metadata && !m?.info) return false;
            const gc = m?.info?.gameCreation ?? m?.gameCreation ?? 0;
            return gc >= SEASON_2026_START;
        });
    }

    function dedupeMatches(arr) {
        const map = new Map();
        for (const m of (arr ?? [])) {
            const id = m?.metadata?.matchId ?? m?.matchId;
            if (id) map.set(id, m);
        }
        return Array.from(map.values());
    }

    // ✅ FIX: helper per impostare recentStats con fallback su errore
    function fetchRecentStats(puuid, r, setter) {
        invoke("get_recent_stats", { puuid, region: r })
            .then(stats => setter(stats))
            .catch(e => {
                console.warn("[recentStats] fallito:", e);
                setter({ champWr7d: [], recentAllies: [] }); // evita spinner infinito
            });
    }

    async function fetchDataWithRegion(r) {
        try {
            const res = await invoke("get_profiles", { region: r });
            setProfileData(res);
            setError(null);
            const isNewPlayer = !matchesInitialized.current || lastLoadedPuuid.current !== res.puuid;
            if (isNewPlayer) {
                matchesInitialized.current = true;
                lastLoadedPuuid.current = res.puuid;
                if (res?.matches) {
                    setAllMatches(dedupeMatches(res.matches));
                    latestMatchId.current = res.matches[0]?.metadata?.matchId ?? null;
                }
                if (res?.puuid) fetchRecentStats(res.puuid, r, setRecentStats);
            }
        } catch (err) {
            console.warn("[fetchDataWithRegion] Chiamata fallita:", err);
        } finally {
            setLoading(false);
        }
    }

    async function fetchData() {
        try {
            const res = await invoke("get_profiles", { region: regionRef.current });
            setProfileData(res);
            setError(null);
            const isNewPlayer = !matchesInitialized.current || lastLoadedPuuid.current !== res.puuid;
            if (isNewPlayer) {
                matchesInitialized.current = true;
                lastLoadedPuuid.current = res.puuid;
                if (res?.matches) {
                    setAllMatches(dedupeMatches(res.matches));
                    latestMatchId.current = res.matches[0]?.metadata?.matchId ?? null;
                }
                if (res?.puuid) fetchRecentStats(res.puuid, regionRef.current, setRecentStats);
            } else {
                try {
                    const more = await invoke("get_more_matches", { puuid: res.puuid, start: 0, region: regionRef.current });
                    const fresh = more ?? [];
                    if (fresh.length > 0) {
                        const newestId = fresh[0]?.metadata?.matchId;
                        if (newestId && newestId !== latestMatchId.current) {
                            latestMatchId.current = newestId;
                            setAllMatches(prev => {
                                const existingIds = new Set(prev.map(m => m?.metadata?.matchId ?? m?.matchId));
                                const newOnes = fresh.filter(m => { const id = m?.metadata?.matchId; return id && !existingIds.has(id); });
                                return newOnes.length > 0 ? [...newOnes, ...prev] : prev;
                            });
                        }
                    }
                } catch (riotErr) { console.warn("[Refresh] Impossibile controllare nuove partite:", riotErr); }
            }
        } catch (err) {
            console.warn("Chiamata fallita:", err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        detectRegionFromLCU();
        fetchData();
        const interval = setInterval(fetchData, 60000);
        const regionInterval = setInterval(detectRegionFromLCU, 30000);
        return () => { clearInterval(interval); clearInterval(regionInterval); };
    }, []);

    useEffect(() => {
        async function checkForUpdates() {
            try {
                const update = await check();
                console.log(`[Updater] currentVersion: ${update?.currentVersion} | latestVersion: ${update?.version} | available: ${update?.available}`);
                if (update?.available && update.version !== update.currentVersion) {
                    updateRef.current = update;
                    setUpdateInfo({ version: update.version, body: update.body ?? "" });
                    setUpdateStatus("available");
                }
            } catch (e) { console.error("[Updater] Errore:", e); }
        }
        checkForUpdates();
    }, []);

    async function handleUpdate() {
        if (!updateRef.current) { await window.__fakeDownload?.(); return; }
        setUpdateStatus("downloading");
        setUpdateProgress(0);
        try {
            await updateRef.current.downloadAndInstall((event) => {
                if (event.event === "Started") setUpdateProgress(0);
                else if (event.event === "Progress") {
                    const { chunkLength, contentLength } = event.data;
                    if (contentLength) setUpdateProgress(prev => Math.min(100, prev + (chunkLength / contentLength) * 100));
                } else if (event.event === "Finished") {
                    setUpdateProgress(100);
                    setUpdateStatus("done");
                    setTimeout(() => relaunch(), 1500);
                }
            });
        } catch (e) { console.error("[Updater] Errore download:", e); setUpdateStatus("available"); }
    }

    function handleDismissUpdate() { setUpdateStatus("idle"); setUpdateInfo(null); }

    async function loadMoreMatches() {
        if (!profileData?.puuid) return 0;
        setLoadingMore(true);
        const snapshot = dedupeMatches(allMatches);
        const existingIds = new Set(snapshot.map(m => m?.metadata?.matchId ?? m?.matchId).filter(Boolean));
        try {
            const more = await invoke("get_more_matches", { puuid: profileData.puuid, start: snapshot.length, region: regionRef.current });
            if (!more || more.length === 0) return 0;
            const trueNew = more.filter(m => { const id = m?.metadata?.matchId ?? m?.matchId; return id && !existingIds.has(id); });
            if (trueNew.length > 0) { setAllMatches(prev => dedupeMatches([...prev, ...trueNew])); return trueNew.length; }
            return 0;
        } catch (e) { console.error("[loadMore] ERROR:", e); return 0; }
        finally { setLoadingMore(false); }
    }

    async function loadMoreSearchMatches() {
        if (!searchData?.puuid) return 0;
        setLoadingMoreSearch(true);
        const currentMatches = dedupeMatches(searchData.matches ?? []);
        const existingIds = new Set(currentMatches.map(m => m?.metadata?.matchId ?? m?.matchId).filter(Boolean));
        try {
            const more = await invoke("get_more_matches", { puuid: searchData.puuid, start: currentMatches.length, region: searchData._region ?? regionRef.current });
            if (!more || more.length === 0) return 0;
            const trueNew = more.filter(m => { const id = m?.metadata?.matchId ?? m?.matchId; return id && !existingIds.has(id); });
            if (trueNew.length > 0) {
                setSearchData(prev => ({ ...prev, matches: dedupeMatches([...(prev.matches ?? []), ...trueNew]) }));
                return trueNew.length;
            }
            return 0;
        } catch (e) { console.error("[loadMoreSearch] ERROR:", e); return 0; }
        finally { setLoadingMoreSearch(false); }
    }

    async function doSearch(gameName, tagLine) {
        setSearching(true);
        setSearchError(null);
        setShowDropdown(false);
        setLiveSuggestions([]);
        try {
            const searchRegion = regionRef.current;
            const res = await invoke("search_summoner", { gameName: gameName.trim(), tagLine: tagLine.trim(), region: searchRegion });
            setSearchData({ ...res, _region: searchRegion });
            setSearchRecentStats(null);
            // ✅ FIX: fallback su errore per searchRecentStats
            if (res?.puuid) fetchRecentStats(res.puuid, searchRegion, setSearchRecentStats);
            const soloEntry = res?.ranked_entries?.find(e => e.queueType === "RANKED_SOLO_5x5");
            saveHistory({
                name: res?.profile?.gameName ?? gameName.trim(),
                tag: res?.profile?.tagLine ?? tagLine.trim(),
                profileIconId: res?.profile?.profileIconId ?? null,
                tier: soloEntry?.tier ?? "",
                rank: soloEntry?.rank ?? soloEntry?.division ?? "",
                lp: soloEntry?.leaguePoints ?? 0,
            });
        } catch (err) {
            console.error("[RLP search] Error:", err);
            setSearchData(null);
            setSearchError(String(err));
        } finally { setSearching(false); }
    }

    async function handleSearch(e) {
        if (e.key !== "Enter" && e.type !== "click") return;
        const raw = searchQuery.trim().replace(/\+/g, " ");
        let gameName, tagLine;
        if (raw.includes("#")) {
            const idx = raw.indexOf("#");
            gameName = raw.slice(0, idx);
            tagLine = raw.slice(idx + 1);
        } else {
            const idx = raw.lastIndexOf("-");
            if (idx === -1) return;
            gameName = raw.slice(0, idx);
            tagLine = raw.slice(idx + 1);
        }
        if (!gameName || !tagLine) return;
        setActiveTab("profile");
        await doSearch(gameName, tagLine);
    }

    async function handlePlayerClick(summonerId) {
        const raw = summonerId.trim().replace(/\+/g, " ");
        let gameName, tagLine;
        if (raw.includes("#")) { const idx = raw.indexOf("#"); gameName = raw.slice(0, idx); tagLine = raw.slice(idx + 1); }
        else { const idx = raw.lastIndexOf("-"); if (idx === -1) return; gameName = raw.slice(0, idx); tagLine = raw.slice(idx + 1); }
        if (!gameName || !tagLine) return;
        setSearchQuery(`${gameName}#${tagLine}`);
        setActiveTab("profile");
        await doSearch(gameName, tagLine);
    }

    function handleViewLiveGame(puuid) {
        liveGamePuuidRef.current = puuid || null;
        setLiveGamePuuid(puuid || null);
        setActiveTab("live-game");
    }

    function handleTabChange(tab) {
        if (tab === "live-game") {
            const activePuuid = searchData?.puuid ?? myPuuid ?? null;
            liveGamePuuidRef.current = activePuuid;
            setLiveGamePuuid(activePuuid);
        }
        setActiveTab(tab);
    }

    function clearSearch() {
        const ownPuuid = profileData?.puuid ?? null;
        liveGamePuuidRef.current = ownPuuid;
        setLiveGamePuuid(ownPuuid);
        setSearchData(null);
        setSearchQuery("");
        setSearchError(null);
    }

    function mapRanked(ranked, queueType) {
        if (!ranked) return null;
        let queue = ranked.queueMap?.[queueType] ?? ranked.queues?.find(q => q.queueType === queueType);
        if (!queue || !queue.tier || queue.tier === "" || queue.division === "NA") return null;
        return { tier: queue.tier, rank: queue.division, leaguePoints: queue.leaguePoints, wins: queue.wins, losses: queue.losses };
    }

    function mapRankedFromEntries(entries, queueType) {
        if (!entries || !Array.isArray(entries)) return null;
        const queue = entries.find(e => e.queueType === queueType);
        if (!queue) return null;
        return { tier: queue.tier, rank: queue.rank, leaguePoints: queue.leaguePoints, wins: queue.wins, losses: queue.losses };
    }

    const rankedSolo = profileData ? mapRanked(profileData.ranked, "RANKED_SOLO_5x5") : null;
    const rankedFlex = profileData ? mapRanked(profileData.ranked, "RANKED_FLEX_SR") : null;
    const myPuuid = profileData?.puuid ?? null;
    const mySummonerName = profileData?.profile?.gameName ? `${profileData.profile.gameName}#${profileData.profile.tagLine}` : null;
    const searchMatches = dedupeMatches(searchData?.matches ?? []);
    const searchRankedSolo = searchData ? mapRankedFromEntries(searchData.ranked_entries, "RANKED_SOLO_5x5") : null;
    const searchRankedFlex = searchData ? mapRankedFromEntries(searchData.ranked_entries, "RANKED_FLEX_SR") : null;
    const activeMatches = searchData ? searchMatches : allMatches;
    const activeProfile = searchData ? searchData.profile : profileData?.profile;

    return (
        <div className="min-h-screen bg-gradient-to-br from-[#040c1a] via-[#070f1e] to-[#040c1a]">
            <header className="border-b border-[#0f2040] bg-[#070f1e]/50 backdrop-blur-sm sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <img src="/RLP Icon.png" alt="RLP Logo" className="w-16 h-16 rounded-xl object-cover" onError={e => { e.target.src = "/RLP_Icon.png"; }} />
                            <div>
                                <h1 className="text-xl font-bold text-white">Raise League Power</h1>
                                <p className="text-xs text-[#5a8ab0]">Statistics & Analytics</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="relative flex items-center">
                                <select
                                    value={region}
                                    onChange={e => changeRegion(e.target.value)}
                                    className="bg-[#0d1f38] border border-[#1a3558] text-white text-sm rounded-lg pl-2 pr-7 py-2 focus:border-[#1e6fff] focus:outline-none cursor-pointer appearance-none"
                                    title={regionAutoDetected ? "Regione rilevata automaticamente dal client" : "Seleziona server"}
                                >
                                    <optgroup label="Europe">
                                        <option value="euw">EUW</option>
                                        <option value="eune">EUNE</option>
                                        <option value="tr">TR</option>
                                        <option value="ru">RU</option>
                                    </optgroup>
                                    <optgroup label="Americas">
                                        <option value="na">NA</option>
                                        <option value="br">BR</option>
                                        <option value="lan">LAN</option>
                                        <option value="las">LAS</option>
                                    </optgroup>
                                    <optgroup label="Asia">
                                        <option value="kr">KR</option>
                                        <option value="jp">JP</option>
                                    </optgroup>
                                    <optgroup label="Pacific">
                                        <option value="oce">OCE</option>
                                        <option value="sg">SG</option>
                                        <option value="tw">TW</option>
                                        <option value="vn">VN</option>
                                    </optgroup>
                                </select>
                                {regionAutoDetected && (
                                    <span className="absolute -top-1.5 -right-1 text-[9px] font-bold bg-[#1e6fff] text-white rounded px-1 leading-tight pointer-events-none" title="Regione rilevata automaticamente dal client League">AUTO</span>
                                )}
                            </div>
                            <div className="relative hidden md:block" ref={searchWrapperRef}>
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a8ab0] pointer-events-none z-10" />
                                <Input
                                    placeholder="Nome Summoner#TAG"
                                    value={searchQuery}
                                    onChange={e => onSearchInput(e.target.value)}
                                    onFocus={() => setShowDropdown(true)}
                                    onKeyDown={e => { if (e.key === "Escape") { setShowDropdown(false); return; } handleSearch(e); }}
                                    className="pl-10 w-72 bg-[#0d1f38] border-[#1a3558] text-white placeholder:text-[#3a6080] focus:border-[#1e6fff] transition-colors"
                                />
                                {showDropdown && (dropdownItems.length > 0 || loadingSuggestions) && (
                                    <div className="absolute top-full left-0 mt-1.5 w-full bg-[#08162b] border border-[#1a3558] rounded-xl shadow-2xl z-50 overflow-hidden">
                                        <div className="flex items-center justify-between px-3 pt-2 pb-1 border-b border-[#0f2040]">
                                            <span className="text-[#3a6080] text-[12px] font-bold uppercase tracking-widest">{searchQuery.trim().length > 0 ? "Risultati" : "Recenti"}</span>
                                            <div className="flex items-center gap-2">
                                                {loadingSuggestions && <span className="text-[#3a6080] text-[12px]">...</span>}
                                                {searchHistory.length > 0 && !searchQuery.trim() && (
                                                    <button onClick={() => { setSearchHistory([]); try { localStorage.removeItem(HISTORY_KEY); } catch { } }} className="text-[#2a5070] hover:text-red-400 text-[12px] transition-colors">Cancella</button>
                                                )}
                                            </div>
                                        </div>
                                        {dropdownItems.map((entry, i) => {
                                            const PATCH_LOCAL = "16.4.1";
                                            const tierColor = { IRON: "text-[#8ab0cc]", BRONZE: "text-amber-600", SILVER: "text-[#9ab8d0]", GOLD: "text-yellow-400", PLATINUM: "text-teal-400", EMERALD: "text-emerald-400", DIAMOND: "text-[#4fc3f7]", MASTER: "text-purple-400", GRANDMASTER: "text-red-400", CHALLENGER: "text-yellow-300" }[entry.tier?.toUpperCase()] ?? "text-[#5a8ab0]";
                                            const tierLabel = entry.tier ? `${entry.tier.charAt(0).toUpperCase()}${entry.tier.slice(1).toLowerCase()}${!["MASTER", "GRANDMASTER", "CHALLENGER"].includes(entry.tier?.toUpperCase()) && entry.rank ? ` ${entry.rank}` : ""}` : null;
                                            return (
                                                <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#0d1f38] cursor-pointer group transition-colors"
                                                    onClick={() => { setSearchQuery(`${entry.name}#${entry.tag}`); setShowDropdown(false); setActiveTab("profile"); doSearch(entry.name, entry.tag); }}>
                                                    <div className="relative shrink-0">
                                                        {entry.profileIconId ? (
                                                            <img src={`https://ddragon.leagueoflegends.com/cdn/${PATCH_LOCAL}/img/profileicon/${entry.profileIconId}.png`} alt="" className="w-7 h-7 rounded-full object-cover border border-[#1a3558]" onError={e => { e.target.style.display = "none"; }} />
                                                        ) : (
                                                            <div className="w-7 h-7 rounded-full bg-[#142545] border border-[#1a3558] flex items-center justify-center"><User className="w-3 h-3 text-[#3a6080]" /></div>
                                                        )}
                                                        {entry._live && <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#1e6fff] rounded-full border border-[#08162b]" />}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-white text-sm font-semibold truncate">{entry.name}</span>
                                                            <span className="text-[#3a6080] text-sm shrink-0">#{entry.tag}</span>
                                                        </div>
                                                        {tierLabel ? <span className={`text-[12px] font-medium ${tierColor}`}>{tierLabel}{entry.lp > 0 ? ` · ${entry.lp}LP` : ""}</span> : <span className="text-[#3a6080] text-[12px]">Unranked</span>}
                                                    </div>
                                                    {!entry._live && (
                                                        <button onClick={e => removeFromHistory(entry, e)} className="text-[#2a5070] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0 p-1" title="Rimuovi">
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <Button onClick={handleSearch} disabled={searching} className="bg-[#1e6fff] hover:bg-[#1459d4] text-white">{searching ? "..." : "Search"}</Button>
                            {searchData && <Button onClick={clearSearch} className="bg-[#142545] hover:bg-[#1e3560] text-white text-xs px-3">✕ Il tuo profilo</Button>}
                        </div>
                    </div>
                </div>
            </header>

            {searchError && (
                <div className="max-w-7xl mx-auto px-4 mt-4">
                    <div className="p-3 bg-red-950/60 border border-red-700/60 text-red-300 rounded-lg text-sm flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-red-400 text-base">⚠</span>
                            <span>{searchError}</span>
                        </div>
                        <button onClick={() => setSearchError(null)} className="text-red-400 hover:text-white text-xs underline shrink-0">Chiudi</button>
                    </div>
                </div>
            )}

            {searchData && (
                <div className="max-w-7xl mx-auto px-4 mt-4">
                    <div className="p-3 bg-[#0a1e4a]/50 border border-[#1459d4] text-[#a8e4ff] rounded-lg text-sm flex items-center justify-between">
                        <span>Stai visualizzando il profilo di <strong>{searchData.profile?.gameName}#{searchData.profile?.tagLine}</strong></span>
                        <button onClick={clearSearch} className="text-[#4fc3f7] hover:text-white text-xs underline">Torna al tuo profilo</button>
                    </div>
                </div>
            )}

            <main className="max-w-7xl mx-auto px-4 py-8">
                <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
                    <TabsList className="bg-[#070f1e] border border-[#0f2040] p-1 rounded-lg">
                        <TabsTrigger value="profile" className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white"><User className="w-4 h-4 mr-2" />Profile</TabsTrigger>
                        <TabsTrigger value="matches" className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white"><History className="w-4 h-4 mr-2" />Match History</TabsTrigger>
                        <TabsTrigger value="masteries" className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white"><Star className="w-4 h-4 mr-2" />Maestrie</TabsTrigger>
                        <TabsTrigger value="meta" className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white"><TrendingUp className="w-4 h-4 mr-2" />Champion Stats</TabsTrigger>
                        <TabsTrigger value="tier-list" className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white"><BarChart2 className="w-4 h-4 mr-2" />Tier List</TabsTrigger>
                        {!searchData && profileData && (
                            <TabsTrigger value="champ-select" className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white relative">
                                <Swords className="w-4 h-4 mr-2" />Auto Import
                                {isInChampSelect && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />}
                            </TabsTrigger>
                        )}
                        <TabsTrigger value="live-game" className="data-[state=active]:bg-[#1e6fff] data-[state=active]:text-white relative">
                            <Tv className="w-4 h-4 mr-2" />Live Game
                            {isInLiveGame && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" title="In partita!" />}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="profile">
                        {searchData ? (
                            <ProfileTab profile={searchData.profile} rankedSolo={searchRankedSolo} rankedFlex={searchRankedFlex} matches={searchMatches} myPuuid={searchData.puuid} mySummonerName={`${searchData.profile?.gameName}#${searchData.profile?.tagLine}`} onViewLiveGame={handleViewLiveGame} isInLiveGame={isInLiveGame} recentStats={searchRecentStats} />
                        ) : profileData ? (
                            <ProfileTab profile={profileData.profile} rankedSolo={rankedSolo} rankedFlex={rankedFlex} matches={allMatches} myPuuid={myPuuid} mySummonerName={mySummonerName} onViewLiveGame={handleViewLiveGame} isInLiveGame={isInLiveGame} recentStats={recentStats} />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64">
                                {loading ? <p className="text-[#5a8ab0] animate-pulse">Inizializzazione in corso...</p> : <p className="text-[#3a6080]">In attesa del client di gioco...</p>}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="matches">
                        {searchData ? (
                            <MatchHistoryTab matches={searchMatches} myPuuid={searchData.puuid} mySummonerName={`${searchData.profile?.gameName}#${searchData.profile?.tagLine}`} onPlayerClick={handlePlayerClick} onLoadMore={loadMoreSearchMatches} loadingMore={loadingMoreSearch} region={region} />
                        ) : profileData ? (
                            <MatchHistoryTab matches={allMatches} myPuuid={myPuuid} mySummonerName={mySummonerName} onPlayerClick={handlePlayerClick} onLoadMore={loadMoreMatches} loadingMore={loadingMore} region={region} />
                        ) : (
                            <div className="flex items-center justify-center h-64">
                                {loading ? <p className="text-[#5a8ab0] animate-pulse">Caricamento partite...</p> : <p className="text-[#3a6080]">In attesa del client di gioco...</p>}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="masteries"><MasteriesTab puuid={searchData?.puuid ?? myPuuid} profile={activeProfile} /></TabsContent>

                    <TabsContent value="meta">
                        <ChampionMetaTab matches={activeMatches} profile={activeProfile} seasonFetchDone={true} metaData={liveMetaData} myPuuid={searchData ? searchData.puuid : myPuuid} mySummonerName={searchData ? `${searchData.profile?.gameName}#${searchData.profile?.tagLine}` : mySummonerName} />
                    </TabsContent>

                    <TabsContent value="tier-list"><MetaTab onMetaDataReady={setLiveMetaData} /></TabsContent>
                    <TabsContent value="champ-select" keepMounted><ChampSelectTab /></TabsContent>
                    <TabsContent value="live-game"><LiveGameTab puuidOverride={liveGamePuuid} myPuuid={myPuuid} region={region} onStatusChange={setIsInLiveGame} /></TabsContent>
                </Tabs>
            </main>

            <UpdateBanner status={updateStatus} info={updateInfo} progress={updateProgress} onUpdate={handleUpdate} onDismiss={handleDismissUpdate} />

            <footer className="border-t border-[#0f2040] bg-[#070f1e]/50 backdrop-blur-sm mt-16">
                <div className="max-w-7xl mx-auto px-4 py-6">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <p className="text-[#5a8ab0] text-sm">RLP isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games.</p>
                        <p className="text-[#3a6080] text-xs">Patch 14.4 • Updated 2 hours ago</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}