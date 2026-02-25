import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Shield, Zap, Package, CheckCircle, XCircle, Loader2, Database, TrendingUp } from "lucide-react";
import { PATCH } from "./constants";

// ── Summoner Spells ──────────────────────────────────────────────────────────
const SPELL_NAME_MAP = {
    flash: "SummonerFlash", ignite: "SummonerDot", teleport: "SummonerTeleport",
    barrier: "SummonerBarrier", exhaust: "SummonerExhaust", ghost: "SummonerHaste",
    heal: "SummonerHeal", cleanse: "SummonerBoost", smite: "SummonerSmite",
    clarity: "SummonerMana", mark: "SummonerSnowball",
};
function spellToDDragon(name) {
    if (!name) return name;
    if (name.toLowerCase().startsWith("summoner")) return name;
    return SPELL_NAME_MAP[name.toLowerCase()] ?? name;
}

// ── Rune helpers ─────────────────────────────────────────────────────────────
const RUNE_PATH_ICONS = {
    8000: "perk-images/Styles/7201_Precision.png",
    8100: "perk-images/Styles/7200_Domination.png",
    8200: "perk-images/Styles/7202_Sorcery.png",
    8300: "perk-images/Styles/7203_Whimsy.png",
    8400: "perk-images/Styles/7204_Resolve.png",
};

const RUNE_PATH_COLORS = {
    8000: "#c8aa6e", // Precision - gold
    8100: "#c44c4c", // Domination - red
    8200: "#6baed6", // Sorcery - blue
    8300: "#a78bfa", // Inspiration - purple
    8400: "#66bb6a", // Resolve - green
};

function useRuneData() {
    const [runeMap, setRuneMap] = useState({});
    useEffect(() => {
        fetch(`https://ddragon.leagueoflegends.com/cdn/${PATCH}/data/en_US/runesReforged.json`)
            .then(r => r.json())
            .then(paths => {
                const map = {};
                for (const path of paths) {
                    map[path.id] = { icon: path.icon, name: path.name, isPath: true };
                    for (const slot of path.slots) {
                        for (const rune of slot.runes) {
                            map[rune.id] = { icon: rune.icon, name: rune.name };
                        }
                    }
                }
                setRuneMap(map);
            })
            .catch(() => { });
    }, []);
    return runeMap;
}

function runeIconUrl(runeId, runeMap) {
    const id = Number(runeId);
    const info = runeMap[id];
    if (info?.icon) return `https://ddragon.leagueoflegends.com/cdn/img/${info.icon}`;
    if (RUNE_PATH_ICONS[id]) return `https://ddragon.leagueoflegends.com/cdn/img/${RUNE_PATH_ICONS[id]}`;
    return null;
}

const STAT_MOD_ICONS = {
    5001: "perk-images/StatMods/StatModsHealthScalingIcon.png",
    5002: "perk-images/StatMods/StatModsArmorIcon.png",
    5003: "perk-images/StatMods/StatModsMagicResIcon.MagicResist_Fix.png",
    5005: "perk-images/StatMods/StatModsAttackSpeedIcon.png",
    5007: "perk-images/StatMods/StatModsCDRScalingIcon.png",
    5008: "perk-images/StatMods/StatModsAdaptiveForceIcon.png",
    5010: "perk-images/StatMods/StatModsMovementSpeedIcon.png",
    5011: "perk-images/StatMods/StatModsHealthPlusIcon.png",
    5013: "perk-images/StatMods/StatModsTenacityIcon.png",
};
function statModUrl(id) {
    const path = STAT_MOD_ICONS[id] ?? "perk-images/StatMods/StatModsAdaptiveForceIcon.png";
    return `https://ddragon.leagueoflegends.com/cdn/img/${path}`;
}

// ── RuneDisplay ──────────────────────────────────────────────────────────────
function RuneDisplay({ runeData, runeMap }) {
    if (!runeData) return (
        <div className="flex items-center justify-center h-24 text-[#3a6080] text-sm">
            Nessuna build disponibile
        </div>
    );

    const {
        primary_path_id: _ppid, primary_rune_ids = [],
        secondary_path_id: _spid, secondary_rune_ids = [],
        stat_mod_ids = [],
    } = runeData;

    // Coerce all IDs to Number — Tauri may serialize u32 in ways that arrive as strings
    const primary_path_id = Number(_ppid);
    const secondary_path_id = Number(_spid);
    // primary_rune_ids = [keystone, slot1, slot2, slot3]
    // Gli 0 vengono tenuti: vengono renderizzati come placeholder grigi
    const primaryRunes = primary_rune_ids.map(Number);
    const secondaryRuneIdsCast = secondary_rune_ids.map(Number).filter(id => id > 0);
    const statModIdsCast = stat_mod_ids.map(Number).filter(id => id > 0);
    const primaryColor = RUNE_PATH_COLORS[primary_path_id] ?? "#4fc3f7";
    const secColor = RUNE_PATH_COLORS[secondary_path_id] ?? "#5a8ab0";

    return (
        <div className="space-y-5">
            {/* Primary path runes */}
            <div>
                <p className="text-xs uppercase tracking-widest mb-2.5" style={{ color: primaryColor }}>
                    {runeData.primary_path_name} — Primario
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                    {primaryRunes.map((id, i) => {
                        const isKeystone = i === 0;
                        const isEmpty = id === 0;
                        const url = isEmpty ? null : runeIconUrl(id, runeMap);
                        return (
                            <div key={id > 0 ? id : `ph-${i}`} className="relative group cursor-default">
                                <div className={`flex items-center justify-center rounded-full
                                    ${isKeystone
                                        ? "w-14 h-14 ring-2 ring-offset-2 ring-offset-[#070f1e] bg-[#0d1f38]"
                                        : isEmpty
                                            ? "w-10 h-10 border-2 border-dashed border-[#1a3558] bg-[#0d1f38]/30"
                                            : "w-10 h-10 bg-[#0d1f38]/70"
                                    }`}
                                    style={isKeystone && !isEmpty ? { "--tw-ring-color": primaryColor, boxShadow: `0 0 12px ${primaryColor}40` } : {}}>
                                    {!isEmpty && url ? (
                                        <img src={url} alt={runeMap[id]?.name ?? String(id)}
                                            className={`object-contain ${isKeystone ? "w-11 h-11" : "w-8 h-8"}`}
                                            onError={e => { e.target.style.display = "none"; }} />
                                    ) : !isEmpty ? (
                                        <div className={`rounded-full bg-[#1a3558] ${isKeystone ? "w-11 h-11" : "w-8 h-8"}`} />
                                    ) : null}
                                </div>
                                {!isEmpty && runeMap[id]?.name && (
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#0a1628] border border-[#1a3558] rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20 transition-opacity shadow-xl">
                                        {runeMap[id].name}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Divider */}
            <div className="h-px bg-gradient-to-r from-transparent via-[#1a3558] to-transparent" />

            {/* Secondary path */}
            <div>
                <p className="text-xs uppercase tracking-widest mb-2.5" style={{ color: secColor }}>
                    {runeData.secondary_path_name} — Secondario
                </p>
                <div className="flex items-center gap-3">
                    {secondaryRuneIdsCast.slice(0, 2).map((id, i) => {
                        const url = runeIconUrl(id, runeMap);
                        return (
                            <div key={id || i} className="relative group cursor-default">
                                <div className="w-10 h-10 flex items-center justify-center rounded-full bg-[#0d1f38]/70 hover:scale-105 transition-transform">
                                    {url ? (
                                        <img src={url} alt={runeMap[id]?.name ?? String(id)}
                                            className="w-8 h-8 object-contain"
                                            onError={e => { e.target.style.display = "none"; }} />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-[#1a3558]" />
                                    )}
                                </div>
                                {runeMap[id]?.name && (
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#0a1628] border border-[#1a3558] rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20 transition-opacity shadow-xl">
                                        {runeMap[id].name}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {/* Placeholders */}
                    {secondaryRuneIdsCast.length < 2 && Array(2 - secondaryRuneIdsCast.length).fill(0).map((_, i) => (
                        <div key={`sph-${i}`} className="w-10 h-10 rounded-full bg-[#0d1f38]/40 border-2 border-dashed border-[#1a3558]" />
                    ))}
                </div>
            </div>

            {/* Stat mods */}
            {statModIdsCast.length > 0 && (
                <>
                    <div className="h-px bg-gradient-to-r from-transparent via-[#1a3558] to-transparent" />
                    <div>
                        <p className="text-xs uppercase tracking-widest text-[#3a6080] mb-2.5">Frammenti</p>
                        <div className="flex items-center gap-2">
                            {statModIdsCast.slice(0, 3).map((id, i) => (
                                <div key={i} className="w-8 h-8 rounded-full bg-[#0d1f38]/70 flex items-center justify-center hover:scale-105 transition-transform">
                                    <img src={statModUrl(id)} alt={String(id)}
                                        className="w-6 h-6 object-contain"
                                        onError={e => { e.target.style.display = "none"; }} />
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

// ── Status helpers ────────────────────────────────────────────────────────────
const STATUS = {
    IDLE: "idle", DETECTING: "detecting", FOUND: "found",
    FETCHING: "fetching", IMPORTING: "importing", DONE: "done", ERROR: "error",
};
const STATUS_LABEL = {
    [STATUS.IDLE]: "In attesa del client...",
    [STATUS.DETECTING]: "Rilevamento champion select...",
    [STATUS.FOUND]: "Campione rilevato, scarico build...",
    [STATUS.FETCHING]: "Recupero build...",
    [STATUS.IMPORTING]: "Importazione in corso...",
    [STATUS.DONE]: "Build importata con successo!",
    [STATUS.ERROR]: "Importazione non riuscita",
};

function StepRow({ icon: Icon, label, done, active, error }) {
    return (
        <div className={`flex items-center gap-3 py-2 px-3 rounded-lg transition-all
            ${active ? "bg-[#0a1e4a]/40 border border-[#1459d4]" : ""}
            ${done ? "opacity-100" : "opacity-40"}
            ${error ? "bg-red-900/30 border border-red-700 opacity-100" : ""}`}>
            <div className="w-7 h-7 flex items-center justify-center">
                {error ? <XCircle className="w-5 h-5 text-red-400" /> :
                    done ? <CheckCircle className="w-5 h-5 text-green-400" /> :
                        active ? <Loader2 className="w-5 h-5 text-[#4fc3f7] animate-spin" /> :
                            <Icon className="w-5 h-5 text-[#3a6080]" />}
            </div>
            <span className={`text-sm font-medium
                ${error ? "text-red-300" : done ? "text-green-300" : active ? "text-[#a8e4ff]" : "text-[#3a6080]"}`}>
                {label}
            </span>
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function ChampSelectTab() {
    const [status, setStatus] = useState(STATUS.IDLE);
    const [champData, setChampData] = useState(null);
    const [importResult, setImportResult] = useState(null);
    const [runeTab, setRuneTab] = useState("opgg");
    const pollRef = useRef(null);
    const importingRef = useRef(false);
    const lastChampRef = useRef(null);
    const runeMap = useRuneData();

    function addLog(msg) {
        console.debug("[RLP champ-select]", new Date().toLocaleTimeString("it-IT"), msg);
    }

    useEffect(() => {
        pollRef.current = setInterval(poll, 2500);
        poll();
        return () => clearInterval(pollRef.current);
    }, []);

    async function poll() {
        try {
            const session = await invoke("get_champ_select_session");
            if (!session || !session.in_progress) {
                if (!importingRef.current) {
                    setStatus(STATUS.DETECTING);
                    if (status === STATUS.DONE || status === STATUS.ERROR) {
                        setChampData(null); setImportResult(null);
                        lastChampRef.current = null; importingRef.current = false;
                    }
                }
                return;
            }
            if (!session.champion_name) return;
            const key = `${session.champion_name}_${session.assigned_position}_${session.game_mode ?? "ranked"}`;
            if (lastChampRef.current === key) return;
            lastChampRef.current = key;
            setChampData(session);
            setStatus(STATUS.FOUND);
            runImport(session);
        } catch (e) {
            if (status !== STATUS.IDLE && status !== STATUS.DETECTING) return;
            setStatus(STATUS.DETECTING);
        }
    }

    async function runImport(session) {
        if (importingRef.current) return;
        importingRef.current = true;
        setImportResult(null);
        setRuneTab("opgg");
        try {
            setStatus(STATUS.FETCHING);
            const result = await invoke("auto_import_build", {
                championName: session.champion_name,
                assignedPosition: session.assigned_position || "DEFAULT",
                gameMode: session.game_mode || "ranked",
            });
            setImportResult(result);
            setStatus(result.errors?.length ? STATUS.ERROR : STATUS.DONE);
        } catch (e) {
            setStatus(STATUS.ERROR);
            addLog(`Errore: ${e}`);
        } finally {
            importingRef.current = false;
        }
    }

    const [applyingRunes, setApplyingRunes] = useState(false);
    const [applyRuneError, setApplyRuneError] = useState(null);

    async function applyRunes(tab) {
        const runeData = tab === "opgg"
            ? importResult?.opgg_runes
            : (hasDbBuild ? {
                champion_name: champData?.champion_name ?? "",
                primary_path_id: importResult.db_build.primary_path_id,
                primary_path_name: importResult.db_build.primary_path_name,
                // [keystone, slot1, slot2, slot3] — il backend padda con 0 gli slot mancanti
                primary_rune_ids: [
                    importResult.db_build.keystone_id,
                    ...(importResult.db_build.primary_slot_ids ?? [])
                ],
                secondary_path_id: importResult.db_build.secondary_path_id,
                secondary_path_name: importResult.db_build.secondary_path_name,
                secondary_rune_ids: importResult.db_build.secondary_rune_ids ?? [],
                stat_mod_ids: importResult?.opgg_runes?.stat_mod_ids?.length >= 3
                    ? importResult.opgg_runes.stat_mod_ids
                    : [5008, 5008, 5002],
            } : null);

        if (!runeData) return;
        setApplyingRunes(true);
        setApplyRuneError(null);
        try {
            await invoke("apply_rune_page", { runeData });
        } catch (e) {
            console.error("[applyRunes] errore:", e);
            setApplyRuneError(String(e));
        } finally {
            setApplyingRunes(false);
        }
    }

    const isActive = (s) => status === s;
    const isDone = (s) => {
        const order = [STATUS.DETECTING, STATUS.FOUND, STATUS.FETCHING, STATUS.IMPORTING, STATUS.DONE];
        return order.indexOf(status) > order.indexOf(s);
    };
    const isError = (s) => status === STATUS.ERROR && s === STATUS.IMPORTING;

    const hasDbBuild = !!importResult?.db_build;

    // Shape DB rune data to match RuneDisplay interface
    const dbRuneData = hasDbBuild ? {
        champion_name: champData?.champion_name ?? "",
        primary_path_id: importResult.db_build.primary_path_id,
        primary_path_name: importResult.db_build.primary_path_name,
        // Ricostruisce primary_rune_ids = [keystone, slot1, slot2, slot3]
        // Gli 0 indicano slot senza dati sufficienti nel DB (verranno mostrati come placeholder)
        primary_rune_ids: [
            importResult.db_build.keystone_id,
            ...(importResult.db_build.primary_slot_ids ?? [0, 0, 0])
        ],
        secondary_path_id: importResult.db_build.secondary_path_id,
        secondary_path_name: importResult.db_build.secondary_path_name,
        secondary_rune_ids: importResult.db_build.secondary_rune_ids ?? [],
        // Default frammenti: Adaptive Force, Adaptive Force, Armor (stesso default del backend)
        // Frammenti: presi da OP.GG se disponibili, altrimenti default Adaptive/Adaptive/Armor
        stat_mod_ids: importResult?.opgg_runes?.stat_mod_ids?.length >= 3
            ? importResult.opgg_runes.stat_mod_ids
            : [5008, 5008, 5002],
    } : null;

    const activeRuneData = runeTab === "opgg" ? importResult?.opgg_runes : dbRuneData;
    const accentColor = RUNE_PATH_COLORS[Number(activeRuneData?.primary_path_id)] ?? "#4fc3f7";

    return (
        <div className="space-y-5">

            {/* ── Champion header ── */}
            <Card className="p-6 bg-gradient-to-br from-[#070f1e] to-[#0d1f38] border-[#0a1e4a]">
                <div className="flex items-center gap-4">
                    <div className="relative shrink-0">
                        {champData?.champion_name ? (
                            <img
                                src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${champData.champion_name}.png`}
                                alt={champData.champion_name}
                                className="w-20 h-20 rounded-xl object-cover border-2 border-[#1e6fff]"
                                onError={e => { e.target.style.display = "none"; }}
                            />
                        ) : (
                            <div className="w-20 h-20 rounded-xl bg-[#142545] flex items-center justify-center">
                                <Shield className="w-10 h-10 text-[#3a6080]" />
                            </div>
                        )}
                        {status === STATUS.DONE && (
                            <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1">
                                <CheckCircle className="w-4 h-4 text-white" />
                            </div>
                        )}
                    </div>
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-white">
                            {champData?.champion_name || "Champion Select"}
                        </h2>
                        {champData?.assigned_position && (
                            <Badge className="mt-1 bg-[#1459d4] text-white border-0 capitalize">
                                {champData.assigned_position.toLowerCase()}
                            </Badge>
                        )}
                        {champData?.game_mode && champData.game_mode !== "ranked" && (
                            <Badge className="mt-1 ml-1 bg-[#7c3aed] text-white border-0 uppercase text-xs">
                                {champData.game_mode}
                            </Badge>
                        )}
                        <p className={`mt-2 text-sm font-medium
                            ${status === STATUS.DONE ? "text-green-400" :
                                status === STATUS.ERROR ? "text-red-400" : "text-[#7dd8ff]"}`}>
                            {STATUS_LABEL[status]}
                        </p>
                    </div>
                </div>
            </Card>

            {/* ── Steps ── */}
            <Card className="p-4 bg-[#070f1e] border-[#1a3558]">
                <h3 className="text-xs font-semibold text-[#5a8ab0] uppercase tracking-wider mb-3">
                    Stato importazione
                </h3>
                <div className="space-y-1">
                    <StepRow icon={Shield} label="Rilevamento champion select"
                        active={isActive(STATUS.DETECTING) || isActive(STATUS.FOUND)}
                        done={isDone(STATUS.DETECTING)} />
                    <StepRow icon={Zap} label="Recupero build..."
                        active={isActive(STATUS.FETCHING)} done={isDone(STATUS.FETCHING)} />
                    <StepRow icon={Package} label="Importazione rune / summoners / item set"
                        active={isActive(STATUS.IMPORTING)} done={isDone(STATUS.IMPORTING)}
                        error={isError(STATUS.IMPORTING)} />
                    <StepRow icon={CheckCircle} label="Build attiva nel client"
                        active={false} done={status === STATUS.DONE} />
                </div>
            </Card>

            {/* ── Result cards ── */}
            {importResult && (
                <>
                    {/* Summoners + Items */}
                    <div className="grid grid-cols-2 gap-4">
                        <Card className="p-4 bg-[#070f1e] border-[#1a3558]">
                            <h4 className="text-[#b8d4e8] font-semibold mb-3 flex items-center gap-2">
                                <Zap className="w-4 h-4 text-yellow-400" /> Summoner Spells
                            </h4>
                            {importResult.summoners_imported ? (
                                <div className="flex gap-3">
                                    {importResult.summoner_spells?.map((s, i) => (
                                        <div key={i} className="text-center">
                                            <img
                                                src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/spell/${spellToDDragon(s)}.png`}
                                                alt={s}
                                                className="w-11 h-11 rounded-lg object-cover border border-[#1a3558]"
                                                onError={e => { e.target.style.display = "none"; }}
                                            />
                                            <p className="text-[#5a8ab0] text-xs mt-1">{s}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-[#3a6080] text-sm">Modalità non-ranked, skip</p>
                            )}
                        </Card>

                        <Card className="p-4 bg-[#070f1e] border-[#1a3558]">
                            <h4 className="text-[#b8d4e8] font-semibold mb-3 flex items-center gap-2">
                                <Package className="w-4 h-4 text-orange-400" /> Item Set
                            </h4>
                            <div className="space-y-1.5">
                                <p className={`text-sm flex items-center gap-1.5 ${importResult.items_imported ? "text-green-400" : "text-red-400"}`}>
                                    {importResult.items_imported
                                        ? <><CheckCircle className="w-3.5 h-3.5" /> OP.GG importato</>
                                        : <>✗ OP.GG non importato</>
                                    }
                                </p>
                                {hasDbBuild && (
                                    <p className={`text-sm flex items-center gap-1.5 ${importResult.db_build.items_imported ? "text-purple-400" : "text-[#5a5080]"}`}>
                                        {importResult.db_build.items_imported
                                            ? <><Database className="w-3.5 h-3.5" /> Dataset DB importato</>
                                            : <><Database className="w-3.5 h-3.5 opacity-50" /> DB non disponibile</>
                                        }
                                    </p>
                                )}
                            </div>
                        </Card>
                    </div>

                    {/* ── Rune panel ── */}
                    <Card className="p-0 bg-[#070f1e] border-[#1a3558] overflow-hidden">

                        {/* Tab switcher */}
                        <div className="flex border-b border-[#1a3558] bg-[#050d1a]">
                            <button
                                onClick={() => { setRuneTab("opgg"); applyRunes("opgg"); }}
                                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold transition-all border-b-2 -mb-px focus:outline-none
                                    ${runeTab === "opgg"
                                        ? "border-[#4fc3f7] text-[#4fc3f7] bg-[#0d1f38]/30"
                                        : "border-transparent text-[#5a8ab0] hover:text-[#8ab0cc] hover:bg-[#0d1f38]/20"}`}
                            >
                                <TrendingUp className="w-3.5 h-3.5" />
                                OP.GG
                            </button>

                            <button
                                onClick={() => { if (hasDbBuild) { setRuneTab("db"); applyRunes("db"); } }}
                                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold transition-all border-b-2 -mb-px focus:outline-none
                                    ${!hasDbBuild
                                        ? "border-transparent text-[#2a4060] cursor-not-allowed"
                                        : runeTab === "db"
                                            ? "border-purple-400 text-purple-300 bg-[#0d1f38]/30"
                                            : "border-transparent text-[#5a8ab0] hover:text-purple-300 hover:bg-[#0d1f38]/20"}`}
                            >
                                <Database className="w-3.5 h-3.5" />
                                Dataset RLP
                                {hasDbBuild && (
                                    <span className="text-xs bg-purple-900/40 text-purple-300 border border-purple-800/50 rounded px-1.5 py-0.5 font-normal">
                                        {importResult.db_build.sample_size.toLocaleString()} partite
                                    </span>
                                )}
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-5">
                            {/* Path summary header */}
                            {activeRuneData && (
                                <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[#1a3558]">
                                    <div className="flex items-center gap-2">
                                        <img
                                            src={`https://ddragon.leagueoflegends.com/cdn/img/${RUNE_PATH_ICONS[Number(activeRuneData.primary_path_id)]}`}
                                            alt={activeRuneData.primary_path_name}
                                            className="w-9 h-9 object-contain"
                                            onError={e => { e.target.style.display = "none"; }}
                                        />
                                        <div>
                                            <p className="font-bold text-sm leading-none" style={{ color: accentColor }}>
                                                {activeRuneData.primary_path_name}
                                            </p>
                                            <p className="text-[#3a6080] text-xs mt-0.5 flex items-center gap-1">
                                                <span>+</span>
                                                <img
                                                    src={`https://ddragon.leagueoflegends.com/cdn/img/${RUNE_PATH_ICONS[Number(activeRuneData.secondary_path_id)]}`}
                                                    alt=""
                                                    className="w-3 h-3 object-contain inline opacity-70"
                                                    onError={e => { e.target.style.display = "none"; }}
                                                />
                                                <span>{activeRuneData.secondary_path_name}</span>
                                            </p>
                                        </div>
                                    </div>
                                    <div className="ml-auto">
                                        {applyingRunes ? (
                                            <span className="text-xs text-yellow-300 bg-yellow-900/30 border border-yellow-700/50 rounded px-2 py-1 flex items-center gap-1">
                                                <Loader2 className="w-3 h-3 animate-spin" /> Applicando...
                                            </span>
                                        ) : applyRuneError ? (
                                            <span className="text-xs text-red-300 bg-red-900/30 border border-red-700/50 rounded px-2 py-1" title={applyRuneError}>
                                                ✗ Errore applicazione
                                            </span>
                                        ) : runeTab === "opgg" ? (
                                            <span className="text-xs text-[#4fc3f7] bg-[#0a1e4a]/60 border border-[#1459d4]/50 rounded px-2 py-1">
                                                Importata nel client ✓
                                            </span>
                                        ) : (
                                            <span className="text-xs text-green-300 bg-green-900/30 border border-green-700/50 rounded px-2 py-1">
                                                Applicata nel client ✓
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            <RuneDisplay runeData={activeRuneData} runeMap={runeMap} />

                            {!activeRuneData && runeTab === "opgg" && (
                                <p className="text-[#3a6080] text-sm py-4">Rune OP.GG non disponibili.</p>
                            )}
                            {!activeRuneData && runeTab === "db" && (
                                <div className="py-4 text-center">
                                    <p className="text-[#3a6080] text-sm">Nessun dato per questo campione/lane.</p>
                                    <p className="text-[#2a5060] text-xs mt-1">Sample insufficiente (min. 5 partite).</p>
                                </div>
                            )}
                        </div>
                    </Card>
                </>
            )}
        </div>
    );
}