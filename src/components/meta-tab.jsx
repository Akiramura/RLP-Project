import { useState, useMemo, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Search, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { Trophy, Target, Zap, TrendingUp } from 'lucide-react';
import { PATCH } from "./constants";


// Mappa champion_id OP.GG → nome DDragon (eccezioni che normalizeName non copre)
const DDRAGON_NAME_OVERRIDES = {
    "Kai'Sa": "Kaisa",
    "Nunu & Willump": "Nunu",
    "Nunu&Willump": "Nunu",
    "NunuWillump": "Nunu",
    "Wukong": "MonkeyKing",
    "Renata Glasc": "Renata",
    "Bel'Veth": "Belveth",
    "Cho'Gath": "Chogath",
    "Fiddlesticks": "FiddleSticks",
    "Kha'Zix": "Khazix",
    "KhaZix": "Khazix",
    "Kog'Maw": "KogMaw",
    "LeBlanc": "Leblanc",
    "Rek'Sai": "RekSai",
    "Vel'Koz": "Velkoz",
    "VelKoz": "Velkoz",
    "Dr. Mundo": "DrMundo",
    "Tahm Kench": "TahmKench",
    "Twisted Fate": "TwistedFate",
    "Master Yi": "MasterYi",
    "Miss Fortune": "MissFortune",
    "Lee Sin": "LeeSin",
    "Jarvan IV": "JarvanIV",
    "Xin Zhao": "XinZhao",
    "Aurelion Sol": "AurelionSol",
    "K'Sante": "KSante",
    "Briar": "Briar",
    "Mel": "Mel",
};

function normalizeName(raw) {
    if (!raw) return raw;
    if (DDRAGON_NAME_OVERRIDES[raw]) return DDRAGON_NAME_OVERRIDES[raw];
    return raw
        .replace(/'/g, "")
        .replace(/\s+/g, "")
        .replace(/\./g, "")
        .replace("&", "");
}

// Mappa posizione OP.GG → chiave lane interna
const POSITION_MAP = {
    top: "top", jungle: "jungle", mid: "mid",
    bottom: "adc", support: "support", adc: "adc",
};

// Converte tier numerico OP.GG (1-5) in tier leggibile
function convertTier(tier) {
    if (typeof tier === "string" && (tier.includes("+") || tier.includes("-") || ["S", "A", "B", "C", "D"].includes(tier))) return tier;
    const map = { 0: "S+", 1: "S+", 2: "S", 3: "A+", 4: "A", 5: "B+", 6: "B", 7: "B-", 8: "C", 9: "D" };
    return map[Number(tier)] || "B";
}

const TIER_ORDER = ["S+", "S", "S-", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-"];

const TIER_STYLE = {
    "S+": { bg: "bg-yellow-500/20", border: "border-yellow-500/40", text: "text-yellow-300" },
    "S": { bg: "bg-yellow-500/15", border: "border-yellow-500/30", text: "text-yellow-400" },
    "S-": { bg: "bg-yellow-500/10", border: "border-yellow-500/20", text: "text-yellow-500" },
    "A+": { bg: "bg-green-500/15", border: "border-green-500/30", text: "text-green-400" },
    "A": { bg: "bg-green-500/10", border: "border-green-500/20", text: "text-green-500" },
    "A-": { bg: "bg-green-500/8", border: "border-green-500/15", text: "text-green-600" },
    "B+": { bg: "bg-blue-500/15", border: "border-blue-500/30", text: "text-blue-300" },
    "B": { bg: "bg-blue-500/10", border: "border-blue-500/20", text: "text-blue-400" },
    "B-": { bg: "bg-blue-500/8", border: "border-blue-500/15", text: "text-blue-500" },
    "C+": { bg: "bg-slate-500/15", border: "border-slate-500/30", text: "text-slate-300" },
    "C": { bg: "bg-slate-500/10", border: "border-slate-500/20", text: "text-slate-400" },
    "C-": { bg: "bg-slate-500/8", border: "border-slate-500/15", text: "text-slate-500" },
    "D+": { bg: "bg-red-500/15", border: "border-red-500/30", text: "text-red-400" },
    "D": { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-500" },
    "D-": { bg: "bg-red-500/8", border: "border-red-500/15", text: "text-red-600" },
};

const LANES = [
    { key: "all", label: "All", icon: "⚔️" },
    { key: "top", label: "Top", icon: "🛡️" },
    { key: "jungle", label: "Jungle", icon: "🌲" },
    { key: "mid", label: "Mid", icon: "✨" },
    { key: "adc", label: "ADC", icon: "🏹" },
    { key: "support", label: "Support", icon: "💊" },
];

// Splitta CSV rispettando le virgolette
function splitCsv(s) {
    const result = [];
    let cur = "", inQ = false;
    for (const c of s) {
        if (c === '"') inQ = !inQ;
        else if (c === "," && !inQ) { result.push(cur); cur = ""; }
        else cur += c;
    }
    if (cur) result.push(cur);
    return result;
}

// ─── PARSER PRINCIPALE (testo proprietario OP.GG) ───────────────────────────
// Struttura: LolListLaneMetaChampions("en_US","all",Data(Positions(
//   [Top(...),Top(...),...],   ← top
//   [Top(...),Top(...),...],   ← mid   (usa ancora "Top" come class name!)
//   [Top(...),Top(...),...],   ← jungle
//   [Top(...),Top(...),...],   ← adc
//   [Top(...),Top(...),...],   ← support
// )))
// NOTA: OP.GG usa "Top(" come class name per TUTTE le lane.
// L'ordine degli array è sempre: top, mid, jungle, adc, support.
function parseOpggText(text) {
    const LANE_ORDER = ["top", "mid", "jungle", "adc", "support"];
    const results = [];

    // 1. Trova l'inizio del contenuto di Positions(
    const posIdx = text.indexOf("Positions([");
    if (posIdx === -1) {
        console.warn("[parseOpggText] 'Positions([' non trovato nel testo");
        return results;
    }

    // 2. Estrai tutto il contenuto di Positions(...) contando le parentesi TONDE.
    //    posOpen punta al '[' che segue 'Positions(' — siamo GIÀ dentro la parentesi
    //    di apertura, quindi depth parte da 1 (non 0) per trovare la ) di chiusura.
    let depth = 1, contentEnd = -1;
    const posOpen = posIdx + "Positions(".length; // punta al '[' subito dopo la '('
    for (let i = posOpen; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") {
            depth--;
            if (depth === 0) { contentEnd = i; break; }
        }
    }
    if (contentEnd === -1) {
        console.warn("[parseOpggText] Parentesi di chiusura Positions non trovata");
        return results;
    }

    // content = "[Top(...),...],[Top(...),...],..." (5 gruppi)
    const content = text.slice(posOpen, contentEnd);

    // 3. Splitta i 5 gruppi trovando ']' a profondità parentetica 0
    const groups = [];
    let groupStart = 0;
    depth = 0;
    for (let i = 0; i < content.length; i++) {
        const c = content[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === "]" && depth === 0) {
            groups.push(content.slice(groupStart, i + 1)); // include la ']'
            if (content[i + 1] === ",") i++; // salta la ',' tra i gruppi
            groupStart = i + 1;
        }
    }

    console.log(`[parseOpggText] Trovati ${groups.length} gruppi (attesi 5)`);

    // 4. Per ogni gruppo, rimuovi le [ ] esterne e parsa ogni record Top(...)
    groups.forEach((group, idx) => {
        const lane = LANE_ORDER[idx];
        if (!lane) return;

        // Rimuovi la '[' iniziale e la ']' finale
        const inner = group.startsWith("[")
            ? group.slice(1, group.lastIndexOf("]"))
            : group;

        // Tutti i record usano "Top(" indipendentemente dalla lane
        const RECORD_RE = /Top\(/g;
        let m;
        let count = 0;
        while ((m = RECORD_RE.exec(inner)) !== null) {
            let s = m.index + 4; // dopo "Top("
            let pd = 1, e = s;
            while (e < inner.length && pd > 0) {
                if (inner[e] === "(") pd++;
                else if (inner[e] === ")") pd--;
                e++;
            }
            const args = inner.slice(s, e - 1);
            const vals = splitCsv(args);
            if (vals.length >= 11) {
                const champion = vals[0].trim().replace(/^"|"$/g, "");
                results.push({
                    champion_id: champion,
                    position: lane,
                    win_rate: parseFloat(vals[5]) || 0.5,
                    pick_rate: parseFloat(vals[6]) || 0,
                    ban_rate: parseFloat(vals[8]) || 0,
                    kda: parseFloat(vals[9]) || 0,
                    tier: parseInt(vals[10]) || 5,
                    games: parseInt(vals[2]) || 0,
                    wins: parseInt(vals[3]) || 0,
                });
                count++;
            }
        }
        console.log(`[parseOpggText] Lane ${lane}: ${count} campioni`);
    });

    console.log(`[parseOpggText] Totale campioni: ${results.length}`);
    return results;
}

// ─── DISPATCHER ─────────────────────────────────────────────────────────────
// Gestisce tutti i formati possibili restituiti da get_tier_list:
//   1. Stringa testo proprietario OP.GG  (caso principale aggiornato)
//   2. Oggetto JSON con positions        (vecchio formato)
//   3. Array piatto JSON                 (vecchio formato)
function parseOpggData(raw) {
    console.log("[parseOpggData] Tipo:", typeof raw);
    console.log("[parseOpggData] Anteprima:", String(raw).slice(0, 200));

    // ── Caso 1: stringa di testo ────────────────────────────────────────────
    if (typeof raw === "string") {
        const items = parseOpggText(raw);
        if (items.length > 0) {
            return items.map(item => ({
                name: normalizeName(item.champion_id),
                rawName: item.champion_id,
                tier: convertTier(item.tier),
                metaWR: parseFloat((item.win_rate * 100).toFixed(2)),
                pick: parseFloat((item.pick_rate * 100).toFixed(2)),
                ban: parseFloat((item.ban_rate * 100).toFixed(2)),
                games: item.games,
                lane: POSITION_MAP[item.position] || item.position,
                kda: parseFloat(item.kda.toFixed(2)),
            })).filter(c => c.name);
        }
        // Se la stringa è JSON, prova a parsarla
        try {
            raw = JSON.parse(raw);
        } catch {
            console.warn("[parseOpggData] La stringa non è JSON e il parser testo ha dato 0 risultati");
            return [];
        }
    }

    // ── Caso 2: oggetto JSON con positions ──────────────────────────────────
    const positions = raw?.data?.positions || raw?.positions;
    if (positions) {
        const laneKeys = ["top", "mid", "jungle", "adc", "support"];
        const results = [];
        for (const lane of laneKeys) {
            for (const item of (positions[lane] || [])) {
                const rawName = item?.champion?.champion_id || item?.champion_id || item?.name;
                if (!rawName) continue;
                const wr = item.win_rate ?? 0.5;
                const pr = item.pick_rate ?? 0;
                const br = item.ban_rate ?? 0;
                results.push({
                    name: normalizeName(rawName),
                    rawName,
                    tier: convertTier(item.tier),
                    metaWR: wr > 1 ? parseFloat(wr.toFixed(2)) : parseFloat((wr * 100).toFixed(2)),
                    pick: pr > 1 ? parseFloat(pr.toFixed(2)) : parseFloat((pr * 100).toFixed(2)),
                    ban: br > 1 ? parseFloat(br.toFixed(2)) : parseFloat((br * 100).toFixed(2)),
                    games: item.games || 0,
                    lane: POSITION_MAP[lane] || lane,
                    kda: parseFloat((item.kda || 0).toFixed(2)),
                });
            }
        }
        return results.filter(c => c.name);
    }

    // ── Caso 3: array piatto ────────────────────────────────────────────────
    const arr = Array.isArray(raw) ? raw : (raw?.data || []);
    return arr.filter(item => item?.champion_id || item?.name).map(item => {
        const rawName = item?.champion_id || item?.name;
        const wr = item.win_rate ?? 0.5;
        const pr = item.pick_rate ?? 0;
        const br = item.ban_rate ?? 0;
        const pos = item.position?.toLowerCase() || "mid";
        return {
            name: normalizeName(rawName),
            rawName,
            tier: convertTier(item.tier),
            metaWR: wr > 1 ? parseFloat(wr.toFixed(2)) : parseFloat((wr * 100).toFixed(2)),
            pick: pr > 1 ? parseFloat(pr.toFixed(2)) : parseFloat((pr * 100).toFixed(2)),
            ban: br > 1 ? parseFloat(br.toFixed(2)) : parseFloat((br * 100).toFixed(2)),
            games: item.games || 0,
            lane: POSITION_MAP[pos] || pos,
            kda: parseFloat((item.kda || 0).toFixed(2)),
        };
    }).filter(c => c.name);
}

// ─── COMPONENTE ─────────────────────────────────────────────────────────────
export function MetaTab({ onMetaDataReady }) {
    const [lane, setLane] = useState("all");
    const [search, setSearch] = useState("");
    const [champions, setChampions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const raw = await invoke("get_tier_list");
            console.log("[TierList] Tipo risposta:", typeof raw);
            console.log("[TierList] Lunghezza:", String(raw).length);
            console.log("[TierList] Primi 300 chars:", String(raw).slice(0, 300));

            const parsed = parseOpggData(raw);
            console.log("[TierList] Campioni parsati:", parsed.length);

            if (parsed.length === 0) throw new Error("Nessun dato ricevuto dall'API");

            setChampions(parsed);
            setLastUpdated(new Date());

            if (onMetaDataReady) {
                const metaMap = {};
                parsed.forEach(c => {
                    metaMap[c.name] = { tier: c.tier, metaWR: c.metaWR, metaGames: c.games };
                });
                onMetaDataReady(metaMap);
            }
        } catch (e) {
            console.error("[TierList] Errore:", e);
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [onMetaDataReady]);

    useEffect(() => { loadData(); }, []);

    const filtered = useMemo(() => {
        return champions.filter(c => {
            const matchLane = lane === "all" || c.lane === lane;
            const matchSearch = c.rawName.toLowerCase().includes(search.toLowerCase()) ||
                c.name.toLowerCase().includes(search.toLowerCase());
            return matchLane && matchSearch;
        });
    }, [champions, lane, search]);

    const grouped = useMemo(() => {
        const map = {};
        filtered.forEach(c => {
            if (!map[c.tier]) map[c.tier] = [];
            map[c.tier].push(c);
        });
        return TIER_ORDER.filter(t => map[t]?.length > 0).map(t => ({ tier: t, champs: map[t] }));
    }, [filtered]);

    return (
        <div className="space-y-6">

            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-xl font-bold text-white">Champion Tier List</h2>
                    <p className="text-slate-400 text-xs mt-0.5">
                        OP.GG EUW • Emerald+ •{" "}
                        {lastUpdated
                            ? `Aggiornato alle ${lastUpdated.toLocaleTimeString("it-IT")}`
                            : "Caricamento..."}
                        {" • "}{champions.length} campioni
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Badge className="bg-slate-800 text-slate-300 border border-slate-700 text-xs">
                        {filtered.length} campioni
                    </Badge>
                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 text-xs transition-all disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                        Aggiorna
                    </button>
                </div>
            </div>

            {/* Loading */}
            {loading && champions.length === 0 && (
                <div className="flex items-center justify-center h-48 gap-3">
                    <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                    <p className="text-slate-400">Caricamento dati...</p>
                </div>
            )}

            {/* Errore */}
            {error && champions.length === 0 && (
                <div className="flex items-center gap-3 p-4 bg-red-900/30 border border-red-700 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                    <div>
                        <p className="text-red-300 text-sm font-medium">Errore nel caricamento dati</p>
                        <p className="text-red-400 text-xs mt-0.5">{error}</p>
                    </div>
                    <button onClick={loadData} className="ml-auto text-xs text-red-300 underline hover:text-white">
                        Riprova
                    </button>
                </div>
            )}

            {/* Filtri */}
            {champions.length > 0 && (
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 flex-wrap">
                        {LANES.map(l => (
                            <button
                                key={l.key}
                                onClick={() => setLane(l.key)}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${lane === l.key
                                    ? "bg-blue-600 text-white shadow"
                                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                                    }`}
                            >
                                <span>{l.icon}</span>
                                {l.label}
                            </button>
                        ))}
                    </div>
                    <div className="relative flex-1 min-w-[180px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Cerca campione..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-600"
                        />
                    </div>
                </div>
            )}

            {/* Tier list */}
            {champions.length > 0 && (
                <div className="space-y-3">
                    {grouped.length === 0 && (
                        <div className="text-center py-16 text-slate-500">Nessun campione trovato.</div>
                    )}
                    {grouped.map(({ tier, champs }) => {
                        const style = TIER_STYLE[tier] || TIER_STYLE["C"];
                        return (
                            <div key={tier} className={`rounded-xl border ${style.border} overflow-hidden`}>
                                <div className={`${style.bg} px-4 py-2 flex items-center gap-3`}>
                                    <span className={`text-2xl font-black w-10 text-center ${style.text}`}>{tier}</span>
                                    <div className="h-px flex-1 bg-white/5" />
                                    <span className="text-slate-500 text-xs">{champs.length} campioni</span>
                                </div>
                                <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 bg-slate-900/60">
                                    {champs.map(c => (
                                        <div
                                            key={`${c.name}-${c.lane}`}
                                            className="flex flex-col items-center gap-1.5 bg-slate-800/60 hover:bg-slate-800 rounded-lg p-2 cursor-pointer transition-all group border border-transparent hover:border-slate-700"
                                        >
                                            <div className="relative">
                                                <img
                                                    src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${c.name}.png`}
                                                    alt={c.rawName}
                                                    className="w-12 h-12 rounded-lg object-cover bg-slate-700 group-hover:scale-105 transition-transform"
                                                    onError={e => { e.target.src = ""; e.target.style.display = "none"; }}
                                                />
                                                <span className="absolute -bottom-1 -right-1 text-xs bg-slate-900 rounded px-0.5 border border-slate-700">
                                                    {LANES.find(l => l.key === c.lane)?.icon}
                                                </span>
                                            </div>
                                            <p className="text-white text-xs font-semibold text-center leading-tight">{c.rawName}</p>
                                            <div className="flex flex-col items-center gap-0.5 w-full">
                                                <span className={`text-xs font-bold ${c.metaWR >= 52 ? "text-green-400" : c.metaWR >= 50 ? "text-slate-300" : "text-red-400"}`}>
                                                    {c.metaWR}% WR
                                                </span>
                                                <div className="flex gap-1 text-slate-500 text-xs">
                                                    <span title="Pick rate">P:{c.pick}%</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <p className="text-center text-slate-600 text-xs pb-4">
                Dati: EUW Emerald+ • {lastUpdated?.toLocaleDateString("it-IT") || "—"}
            </p>
        </div>
    );
}