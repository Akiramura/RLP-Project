import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "./ui/badge";
import { Shield, Zap, Package, CheckCircle, XCircle, Loader2, Swords } from "lucide-react";
import { PATCH } from "./constants";

// ─── Summoner Spell name → DDragon ────────────────────────────────────────────
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

// ─── Hook: load runesReforged.json from DDragon ────────────────────────────────
// Returns { runeMap: {id → {name, icon, iconUrl}}, pathTree: [{id, name, icon, slots:[{runes:[]}]}] }
function useRuneData() {
    const [data, setData] = useState({ runeMap: {}, pathTree: [] });
    useEffect(() => {
        fetch(`https://ddragon.leagueoflegends.com/cdn/${PATCH}/data/en_US/runesReforged.json`)
            .then(r => r.json())
            .then(json => {
                const runeMap = {};
                // DDragon icon path: "perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png"
                // URL: https://ddragon.leagueoflegends.com/cdn/img/{icon}
                const iconUrl = icon => `https://ddragon.leagueoflegends.com/cdn/img/${icon}`;

                for (const path of json) {
                    // Register path itself
                    runeMap[path.id] = { name: path.name, icon: path.icon, iconUrl: iconUrl(path.icon), isPath: true };
                    for (const slot of path.slots) {
                        for (const rune of slot.runes) {
                            runeMap[rune.id] = { name: rune.name, icon: rune.icon, iconUrl: iconUrl(rune.icon) };
                        }
                    }
                }

                setData({ runeMap, pathTree: json });
            })
            .catch(() => { });
    }, []);
    return data;
}

// ─── Stat mod definitions (fixed, don't change often) ─────────────────────────
// Using CDragon URLs with verified working paths
const STAT_MODS = {
    5001: { name: "Health Scaling", url: "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmodshealthscalingicon.png" },
    5002: { name: "Armor", url: "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmodsarmoricon.png" },
    5003: { name: "Magic Resist", url: "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmodsmagicresicon.png" },
    5005: { name: "Attack Speed", url: "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmodsattackspeedicon.png" },
    5007: { name: "CDR Scaling", url: "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmodscdrbscalingicon.png" },
    5008: { name: "Adaptive Force", url: "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmodsadaptiveforceicon.png" },
    5010: { name: "Move Speed", url: "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmodsmovestraticon.png" },
    5011: { name: "Health", url: "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmodshealthscalingicon.png" },
    5013: { name: "Tenacity", url: "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmodstenaicyicon.png" },
};

// Stat shard slot definitions — each row has 3 options
// Row 0: Offense (Adaptive / Attack Speed / CDR)
// Row 1: Flex    (Adaptive / Armor / MR)
// Row 2: Defense (Health / Armor / MR)
const STAT_SLOTS = [
    [5008, 5005, 5007], // offense
    [5008, 5002, 5003], // flex
    [5001, 5002, 5003], // defense
];

// ─── Path color map ───────────────────────────────────────────────────────────
const PATH_COLORS = {
    8000: "#c8a84b", // Precision (gold)
    8100: "#d44242", // Domination (red)
    8200: "#9b6fdb", // Sorcery (purple)
    8300: "#57c3b0", // Inspiration (teal)
    8400: "#4aad4a", // Resolve (green)
};

// ─── Status ───────────────────────────────────────────────────────────────────
const STATUS = { IDLE: "idle", DETECTING: "detecting", FOUND: "found", FETCHING: "fetching", IMPORTING: "importing", DONE: "done", ERROR: "error" };
const STATUS_LABEL = {
    [STATUS.IDLE]: "In attesa del client...", [STATUS.DETECTING]: "Rilevamento champion select...",
    [STATUS.FOUND]: "Campione rilevato...", [STATUS.FETCHING]: "Recupero build da OP.GG...",
    [STATUS.IMPORTING]: "Importazione in corso...", [STATUS.DONE]: "Build importata con successo!",
    [STATUS.ERROR]: "Importazione non riuscita",
};
const LANE_LABELS = {
    top: "Top", jungle: "Jungle", mid: "Mid", middle: "Mid", adc: "ADC",
    bottom: "Bot", support: "Support", utility: "Support", fill: "Fill", default: "Default",
};

// ─── Rune image with fallback ─────────────────────────────────────────────────
function RuneImg({ url, name = "", size = "w-full h-full", dimmed = false, glow = false, glowColor = "#c8a84b" }) {
    const [failed, setFailed] = useState(false);
    if (!url || failed) {
        return <div className={`${size} rounded-full bg-[#0a1525] border border-[#1a3558]/40`} />;
    }
    return (
        <img
            src={url} alt={name}
            className={`${size} object-contain transition-all duration-200
                ${dimmed ? "opacity-25 grayscale" : "opacity-100"}`}
            style={glow && !dimmed ? { filter: `drop-shadow(0 0 6px ${glowColor}88)` } : {}}
            onError={() => setFailed(true)}
        />
    );
}

// ─── Rune slot row: shows all options, highlights selected ────────────────────
function RuneSlotRow({ runes, selectedIds, runeMap, isKeystone = false }) {
    const selSet = new Set(Array.isArray(selectedIds) ? selectedIds : [selectedIds]);
    return (
        <div className="flex justify-center items-center gap-2 flex-wrap">
            {runes.map(rune => {
                const sel = selSet.has(rune.id);
                if (isKeystone) {
                    return (
                        <div key={rune.id} title={rune.name}
                            className={`relative flex items-center justify-center rounded-full shrink-0 transition-all
                                ${sel ? "w-[52px] h-[52px] border-2 bg-[#0a1525]" : "w-8 h-8 border border-[#ffffff08] bg-[#070f1e]"}`}
                            style={{ borderColor: sel ? "rgba(255,255,255,0.3)" : undefined }}>
                            {sel && <div className="absolute inset-0 rounded-full opacity-10 blur-lg pointer-events-none bg-white" />}
                            <RuneImg url={runeMap[rune.id]?.iconUrl} name={rune.name}
                                size={sel ? "w-[46px] h-[46px]" : "w-7 h-7"}
                                dimmed={!sel} glow={sel} glowColor="#ffffff" />
                        </div>
                    );
                }
                return (
                    <div key={rune.id} title={rune.name}
                        className={`flex items-center justify-center rounded-full shrink-0 transition-all
                            ${sel ? "w-9 h-9 border border-[#ffffff15] bg-[#0a1525]" : "w-7 h-7 bg-transparent"}`}>
                        <RuneImg url={runeMap[rune.id]?.iconUrl} name={rune.name}
                            size={sel ? "w-8 h-8" : "w-6 h-6"} dimmed={!sel} />
                    </div>
                );
            })}
        </div>
    );
}

// ─── Full visual rune tree — 3-column layout like OP.GG ──────────────────────
// Column 1: Primary path (keystone + 3 minor slots, each row shows all options)
// Column 2: Secondary path (3 minor slots shown, 2 are selected)
// Column 3: Stat shards (3 rows × 3 options)
function RuneTree({ primaryIds = [], subIds = [], statIds = [], primaryPathId, subPathId, runeData }) {
    const { runeMap, pathTree } = runeData;

    const primaryPath = pathTree.find(p => p.id === primaryPathId);
    const subPath = pathTree.find(p => p.id === subPathId);

    if (Object.keys(runeMap).length === 0) {
        return (
            <div className="flex items-center justify-center h-40">
                <Loader2 className="w-5 h-5 text-[#3a6080] animate-spin" />
            </div>
        );
    }

    const primaryColor = PATH_COLORS[primaryPathId] ?? "#c8a84b";
    const subColor = PATH_COLORS[subPathId] ?? "#9b6fdb";

    const selectedKeystone = primaryIds[0];
    const selectedPrimary = primaryIds.slice(1);
    const selectedSub = new Set(subIds.slice(0, 2));
    const selectedStats = statIds.slice(0, 3);

    // The secondary path shows all 3 minor slot rows (slots[1..3]).
    // User picked 2 runes from 2 different rows — those are highlighted, rest dimmed.
    const subMinorSlots = subPath?.slots.slice(1) ?? [];

    // Stat shard slot options per row
    // Row 0 = Offense, Row 1 = Flex, Row 2 = Defense
    const statSlotRows = STAT_SLOTS;

    // ─── Column component for DRY rendering ────────────────────────────────
    const colClass = "flex flex-col gap-2.5 flex-1 min-w-0";
    const headerClass = "flex items-center gap-1.5 h-5 mb-0.5";
    const rowClass = "flex justify-center items-center gap-1.5 flex-wrap min-h-[36px]";

    return (
        <div className="flex gap-1 w-full">

            {/* ══ COLUMN 1: Primary Path ══════════════════════════════════════ */}
            <div className={colClass}>
                {/* Header */}
                <div className={headerClass}>
                    {runeMap[primaryPathId]?.iconUrl && (
                        <img src={runeMap[primaryPathId].iconUrl} alt=""
                            className="w-4 h-4 object-contain shrink-0"
                            onError={e => { e.target.style.display = "none"; }} />
                    )}
                    <span className="text-[10px] font-bold uppercase tracking-wider truncate"
                        style={{ color: primaryColor }}>
                        {primaryPath?.name ?? "Primary"}
                    </span>
                </div>

                {/* Keystone row — all 4 options, selected highlighted */}
                <div className="flex justify-center items-center gap-1.5 flex-wrap min-h-[60px]">
                    {primaryPath?.slots[0]?.runes.map(rune => {
                        const sel = rune.id === selectedKeystone;
                        return (
                            <div key={rune.id} title={rune.name}
                                className={`relative flex items-center justify-center rounded-full shrink-0 transition-all
                                    ${sel ? "w-[52px] h-[52px] border-2 bg-[#0a1525]" : "w-8 h-8 border border-[#ffffff08] bg-[#070f1e]"}`}
                                style={{ borderColor: sel ? primaryColor + "70" : undefined }}>
                                {sel && (
                                    <div className="absolute inset-0 rounded-full opacity-10 blur-lg pointer-events-none"
                                        style={{ background: primaryColor }} />
                                )}
                                <RuneImg url={runeMap[rune.id]?.iconUrl} name={rune.name}
                                    size={sel ? "w-[46px] h-[46px]" : "w-7 h-7"}
                                    dimmed={!sel} glow={sel} glowColor={primaryColor} />
                            </div>
                        );
                    }) ?? (
                            // Fallback
                            selectedKeystone && (
                                <div className="w-[52px] h-[52px] rounded-full border-2 bg-[#0a1525] flex items-center justify-center"
                                    style={{ borderColor: primaryColor + "60" }}>
                                    <RuneImg url={runeMap[selectedKeystone]?.iconUrl}
                                        name={runeMap[selectedKeystone]?.name ?? ""}
                                        size="w-[46px] h-[46px]" glow glowColor={primaryColor} />
                                </div>
                            )
                        )}
                </div>

                {/* Minor slots 1, 2, 3 */}
                {(primaryPath?.slots.slice(1) ?? [null, null, null]).map((slot, si) => {
                    const selId = selectedPrimary[si];
                    const runes = slot?.runes ?? [];
                    return (
                        <div key={si} className={rowClass}>
                            {runes.length > 0 ? runes.map(rune => {
                                const sel = rune.id === selId;
                                return (
                                    <div key={rune.id} title={rune.name}
                                        className={`flex items-center justify-center rounded-full shrink-0 transition-all
                                            ${sel ? "w-9 h-9 border border-[#ffffff15] bg-[#0a1525]" : "w-7 h-7"}`}>
                                        <RuneImg url={runeMap[rune.id]?.iconUrl} name={rune.name}
                                            size={sel ? "w-8 h-8" : "w-6 h-6"} dimmed={!sel} />
                                    </div>
                                );
                            }) : selId ? (
                                <div className="w-9 h-9 rounded-full border border-[#ffffff15] bg-[#0a1525] flex items-center justify-center">
                                    <RuneImg url={runeMap[selId]?.iconUrl} name="" size="w-8 h-8" />
                                </div>
                            ) : (
                                <div className="w-9 h-9 rounded-full border border-[#1a3558]/15 bg-[#070f1e]" />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Divider */}
            <div className="w-px self-stretch bg-gradient-to-b from-transparent via-[#1a3558]/40 to-transparent shrink-0 mx-1" />

            {/* ══ COLUMN 2: Secondary Path ════════════════════════════════════ */}
            <div className={colClass}>
                {/* Header */}
                <div className={headerClass}>
                    {runeMap[subPathId]?.iconUrl && (
                        <img src={runeMap[subPathId].iconUrl} alt=""
                            className="w-3.5 h-3.5 object-contain shrink-0 opacity-80"
                            onError={e => { e.target.style.display = "none"; }} />
                    )}
                    <span className="text-[10px] font-semibold uppercase tracking-wider truncate"
                        style={{ color: subColor + "cc" }}>
                        {subPath?.name ?? "Secondary"}
                    </span>
                </div>

                {/* Empty spacer matching keystone row height */}
                <div className="min-h-[60px]" />

                {/* All 3 minor slot rows — 2 of them have a selected rune */}
                {subMinorSlots.length > 0 ? subMinorSlots.map((slot, si) => (
                    <div key={si} className={rowClass}>
                        {slot.runes.map(rune => {
                            const sel = selectedSub.has(rune.id);
                            return (
                                <div key={rune.id} title={rune.name}
                                    className={`flex items-center justify-center rounded-full shrink-0 transition-all
                                        ${sel ? "w-9 h-9 border border-[#ffffff15] bg-[#0a1525]" : "w-7 h-7"}`}>
                                    <RuneImg url={runeMap[rune.id]?.iconUrl} name={rune.name}
                                        size={sel ? "w-8 h-8" : "w-6 h-6"} dimmed={!sel} />
                                </div>
                            );
                        })}
                    </div>
                )) : (
                    // Fallback: show the 2 selected
                    <div className={rowClass}>
                        {[...selectedSub].map(id => (
                            <div key={id} className="w-9 h-9 rounded-full border border-[#ffffff15] bg-[#0a1525] flex items-center justify-center">
                                <RuneImg url={runeMap[id]?.iconUrl} name="" size="w-8 h-8" />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Divider */}
            <div className="w-px self-stretch bg-gradient-to-b from-transparent via-[#1a3558]/40 to-transparent shrink-0 mx-1" />

            {/* ══ COLUMN 3: Stat Shards ════════════════════════════════════════ */}
            <div className="flex flex-col gap-2.5 w-[72px] shrink-0">
                {/* Header */}
                <div className={headerClass}>
                    <span className="text-[10px] font-semibold text-[#3a6080] uppercase tracking-wider w-full text-center">
                        Frammenti
                    </span>
                </div>

                {/* Empty spacer matching keystone row */}
                <div className="min-h-[60px]" />

                {/* 3 stat shard rows, each with 3 options */}
                {statSlotRows.map((rowOptions, ri) => {
                    const selId = selectedStats[ri];
                    return (
                        <div key={ri} className={rowClass}>
                            {rowOptions.map(statId => {
                                const stat = STAT_MODS[statId];
                                const sel = statId === selId;
                                return (
                                    <div key={statId} title={stat?.name ?? String(statId)}
                                        className={`flex items-center justify-center rounded-full shrink-0 transition-all
                                            ${sel ? "w-7 h-7 border border-[#ffffff15] bg-[#0a1525]" : "w-5 h-5"}`}>
                                        <RuneImg url={stat?.url} name={stat?.name ?? ""}
                                            size={sel ? "w-6 h-6" : "w-4 h-4"} dimmed={!sel} />
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>

        </div>
    );
}

// ─── Step dot ─────────────────────────────────────────────────────────────────
function StepDot({ n, done, active, error }) {
    return (
        <div className={`flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold transition-all
            ${error ? "border-red-500 bg-red-500/20" : done ? "border-green-500 bg-green-500/20" : active ? "border-blue-400 bg-blue-400/10" : "border-[#1a3558]"}`}>
            {error ? <XCircle className="w-3.5 h-3.5 text-red-400" /> :
                done ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> :
                    active ? <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" /> :
                        <span className="text-[#2a4060]">{n}</span>}
        </div>
    );
}

// ─── Lane selector keystone (uses runeMap) ────────────────────────────────────
function LaneKeystone({ runeId, runeMap }) {
    const rune = runeMap[runeId];
    if (!rune?.iconUrl) return <div className="w-10 h-10 rounded-full bg-[#0d1f38]" />;
    return <img src={rune.iconUrl} alt={rune.name ?? ""} className="w-10 h-10 rounded-full object-contain bg-[#0a1525]" onError={e => { e.target.style.display = "none"; }} />;
}

// ─── Main component ───────────────────────────────────────────────────────────
export function ChampSelectTab() {
    const [status, setStatus] = useState(STATUS.IDLE);
    const [champData, setChampData] = useState(null);
    const [importResult, setImportResult] = useState(null);
    const [lastError, setLastError] = useState(null);
    const pollRef = useRef(null);
    const importingRef = useRef(false);
    const lastChampRef = useRef(null);
    const [activeRuneLane, setActiveRuneLane] = useState(null);
    const [switchingLane, setSwitchingLane] = useState(false);
    const [activePreset, setActivePreset] = useState(0);
    const [switchingPreset, setSwitchingPreset] = useState(false);

    const runeData = useRuneData();

    useEffect(() => {
        pollRef.current = setInterval(poll, 2500);
        poll();
        return () => clearInterval(pollRef.current);
    }, []);

    async function poll() {
        try {
            const session = await invoke("get_champ_select_session");
            if (!session?.in_progress) {
                setStatus(STATUS.DETECTING); setChampData(null); setImportResult(null);
                lastChampRef.current = null; importingRef.current = false; return;
            }
            if (!session.champion_name) return;
            const key = `${session.champion_name}_${session.assigned_position}_${session.game_mode ?? "ranked"}`;
            if (lastChampRef.current === key) return;
            lastChampRef.current = key;
            setChampData(session); setStatus(STATUS.FOUND);
            runImport(session);
        } catch { setStatus(STATUS.DETECTING); }
    }

    async function switchPreset(presetIndex) {
        if (switchingPreset || !champData || presetIndex === activePreset) return;
        setSwitchingPreset(true);
        try {
            const result = await invoke("import_rune_preset", {
                championName: champData.champion_name,
                position: champData.assigned_position || "DEFAULT",
                presetIndex,
            });
            setActivePreset(presetIndex);
            setImportResult(prev => ({
                ...prev,
                primary_rune_ids: result.primary_rune_ids,
                sub_rune_ids: result.sub_rune_ids,
                stat_mod_ids: result.stat_mod_ids,
                primary_page_id: result.primary_page_id,
                sub_page_id: result.sub_page_id,
                rune_presets: result.rune_presets?.length ? result.rune_presets : prev?.rune_presets,
                active_rune_preset: presetIndex,
            }));
        } catch (e) { console.error(e); }
        finally { setSwitchingPreset(false); }
    }

    async function switchRuneLane(lane) {
        if (switchingLane || !champData) return;
        setSwitchingLane(true);
        try {
            const gm = champData.game_mode;
            const modeLabel = gm === "aram" ? "ARAM" : gm === "urf" ? "URF" : lane;
            const result = await invoke("import_runes_for_lane", { championName: champData.champion_name, lane, modeLabel });
            setActiveRuneLane(lane);
            setImportResult(prev => prev ? {
                ...prev, ...result,
                active_rune_lane: lane,
                // preserve available_lanes from prev — import_runes_for_lane returns empty vec
                available_lanes: (result.available_lanes?.length > 0 ? result.available_lanes : prev?.available_lanes) ?? [],
            } : result);
        } catch (e) { console.error(e); }
        finally { setSwitchingLane(false); }
    }

    async function runImport(session) {
        if (importingRef.current) return;
        importingRef.current = true; setLastError(null); setImportResult(null);
        try {
            setStatus(STATUS.FETCHING);
            const result = await invoke("auto_import_build", {
                championName: session.champion_name,
                assignedPosition: session.assigned_position || "DEFAULT",
                gameMode: session.game_mode || "ranked",
            });
            setStatus(STATUS.IMPORTING); setImportResult(result);
            if (result.errors?.length > 0) setStatus(STATUS.ERROR);
            else { setStatus(STATUS.DONE); setActiveRuneLane(result.active_rune_lane ?? null); }
            // Fetch lane builds separately (non-blocking) to avoid slowing down main import
            if (session.champion_name) {
                invoke("fetch_lanes_for_champion", { championName: session.champion_name })
                    .then(lanes => {
                        if (lanes?.length > 0) {
                            setImportResult(prev => prev ? { ...prev, available_lanes: lanes } : prev);
                        }
                    })
                    .catch(e => console.warn("fetch_lanes_for_champion failed:", e));
            }
        } catch (e) { setStatus(STATUS.ERROR); setLastError(String(e)); lastChampRef.current = null; }
        finally { importingRef.current = false; }
    }

    const isDone = s => { const o = [STATUS.DETECTING, STATUS.FOUND, STATUS.FETCHING, STATUS.IMPORTING, STATUS.DONE]; return o.indexOf(status) > o.indexOf(s); };
    const isActive = s => status === s;
    const isError = s => status === STATUS.ERROR && s === STATUS.IMPORTING;

    const champName = champData?.champion_name;
    const laneLabel = LANE_LABELS[(champData?.assigned_position || "").toLowerCase()] ?? champData?.assigned_position ?? "—";

    // Extract rune tree data — prefer the active preset if available
    let runeTreeData = null;
    if (importResult) {
        const presets = importResult.rune_presets;
        if (presets?.length > 0) {
            // Use preset data
            const preset = presets[activePreset] ?? presets[0];
            runeTreeData = {
                primaryIds: preset.primary_rune_ids ?? [],
                subIds: preset.sub_rune_ids ?? [],
                statIds: preset.stat_mod_ids ?? [],
                primaryPathId: preset.primary_page_id,
                subPathId: preset.sub_page_id,
            };
        } else if (importResult.primary_rune_ids?.length > 0) {
            runeTreeData = {
                primaryIds: importResult.primary_rune_ids,
                subIds: importResult.sub_rune_ids ?? [],
                statIds: importResult.stat_mod_ids ?? [],
                primaryPathId: importResult.primary_page_id,
                subPathId: importResult.sub_page_id,
            };
        } else if (importResult.available_lanes?.length > 0) {
            const activeName = activeRuneLane ?? importResult.active_rune_lane;
            const al = importResult.available_lanes.find(l => l.lane === activeName) ?? importResult.available_lanes[0];
            if (al) runeTreeData = {
                primaryIds: al.primary_rune_ids ?? [],
                subIds: al.sub_rune_ids ?? [],
                statIds: al.stat_mod_ids ?? [],
                primaryPathId: al.primary_page_id,
                subPathId: al.sub_page_id,
            };
        }
    }

    // ── Idle state ─────────────────────────────────────────────────────────────
    if (!champName) {
        return (
            <div className="min-h-[360px] flex flex-col items-center justify-center gap-5 select-none">
                <div className="relative">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#0d1f38] to-[#070f1e] border border-[#1a3558] flex items-center justify-center">
                        <Swords className="w-9 h-9 text-[#1e4a80] opacity-50" />
                    </div>
                    <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-yellow-400 animate-pulse shadow shadow-yellow-400/50" />
                </div>
                <div className="text-center">
                    <p className="text-white font-semibold">Auto Import attivo</p>
                    <p className="text-[#3a6080] text-sm mt-1">Avvia il Champion Select per importare la build automaticamente</p>
                </div>
                <div className="flex gap-2">
                    {[0, 150, 300].map(d => <span key={d} className="w-2 h-2 rounded-full bg-[#1a3558] animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                </div>
            </div>
        );
    }

    // ── Active state ───────────────────────────────────────────────────────────
    return (
        <div className="space-y-4 pb-4">

            {/* HERO */}
            <div className="relative rounded-2xl overflow-hidden border border-[#1a3558] min-h-[180px]">
                <img src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champName}_0.jpg`}
                    alt="" className="absolute inset-0 w-full h-full object-cover object-top opacity-20 blur-sm scale-110" />
                <div className="absolute inset-0 bg-gradient-to-r from-[#070f1e] via-[#070f1e]/85 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#070f1e] via-transparent to-transparent" />

                <div className="relative z-10 flex items-end gap-5 p-5 min-h-[180px]">
                    <div className={`shrink-0 self-end rounded-xl border-2 overflow-hidden w-20 h-20
                        ${status === STATUS.DONE ? "border-green-500/70" : status === STATUS.ERROR ? "border-red-500/60" : "border-[#1e6fff]/60"}`}>
                        <img src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${champName}.png`}
                            alt={champName} className="w-full h-full object-cover" onError={e => { e.target.style.display = "none"; }} />
                    </div>
                    <div className="flex-1 pb-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-2xl font-black text-white">{champName}</span>
                            <Badge className="bg-[#1e6fff]/70 text-white border-0 text-xs">{laneLabel}</Badge>
                            {champData?.game_mode && champData.game_mode !== "ranked" && (
                                <Badge className="bg-purple-700/70 text-white border-0 text-xs uppercase">{champData.game_mode}</Badge>
                            )}
                        </div>
                        <p className={`text-sm font-medium ${status === STATUS.DONE ? "text-green-400" : status === STATUS.ERROR ? "text-red-400" : "text-[#7dd8ff]"}`}>
                            {STATUS_LABEL[status]}
                        </p>
                    </div>
                    <div className="hidden md:flex flex-col gap-2 shrink-0 pb-1">
                        {[
                            { n: 1, label: "Rilevamento", done: isDone(STATUS.DETECTING), active: isActive(STATUS.DETECTING) || isActive(STATUS.FOUND) },
                            { n: 2, label: "Recupero build", done: isDone(STATUS.FETCHING), active: isActive(STATUS.FETCHING) },
                            { n: 3, label: "Importazione", done: isDone(STATUS.IMPORTING), active: isActive(STATUS.IMPORTING), error: isError(STATUS.IMPORTING) },
                            { n: 4, label: "Completato", done: status === STATUS.DONE, error: status === STATUS.ERROR },
                        ].map(s => (
                            <div key={s.n} className="flex items-center gap-2">
                                <StepDot {...s} />
                                <span className={`text-xs ${s.error ? "text-red-300" : s.done ? "text-green-400" : s.active ? "text-blue-300" : "text-[#2a4060]"}`}>{s.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* RESULTS */}
            {importResult && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                    {/* RUNE PANEL */}
                    <div className="rounded-xl border border-[#1a3558] bg-[#070f1e] p-4">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-[#5a8ab0] uppercase tracking-widest flex items-center gap-1.5">
                                <Shield className="w-3.5 h-3.5 text-purple-400" /> Rune
                            </h4>
                            {importResult.runes_imported
                                ? <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Importate</span>
                                : <span className="text-red-400 text-xs flex items-center gap-1"><XCircle className="w-3 h-3" /> Fallito</span>}
                        </div>

                        {/* Preset tabs — show if multiple presets available (like OP.GG) */}
                        {importResult.rune_presets?.length > 1 && (
                            <div className="flex gap-1.5 mb-3 flex-wrap">
                                {importResult.rune_presets.map((preset, idx) => {
                                    const isActive = idx === activePreset;
                                    const keystoneId = preset.primary_rune_ids?.[0];
                                    const keystoneUrl = runeData.runeMap[keystoneId]?.iconUrl;
                                    const primaryPathUrl = runeData.runeMap[preset.primary_page_id]?.iconUrl;
                                    const subPathUrl = runeData.runeMap[preset.sub_page_id]?.iconUrl;
                                    const primaryColor = PATH_COLORS[preset.primary_page_id] ?? "#c8a84b";
                                    return (
                                        <button
                                            key={idx}
                                            disabled={switchingPreset}
                                            onClick={() => switchPreset(idx)}
                                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all flex-1 min-w-0
                                                ${isActive
                                                    ? "border-[#1e6fff]/70 bg-[#0a1e4a]/80 shadow-md"
                                                    : "border-[#1a3558]/50 bg-[#0a1525]/50 hover:border-[#244570] opacity-60 hover:opacity-80"}
                                                ${switchingPreset ? "cursor-not-allowed" : "cursor-pointer"}`}>
                                            {/* Keystone icon */}
                                            {keystoneUrl && (
                                                <img src={keystoneUrl} alt="" className="w-7 h-7 rounded-full shrink-0 object-contain"
                                                    onError={e => { e.target.style.display = "none"; }} />
                                            )}
                                            {/* Path icons */}
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-1">
                                                    {primaryPathUrl && <img src={primaryPathUrl} alt="" className="w-3 h-3 object-contain" onError={e => { e.target.style.display = "none"; }} />}
                                                    <span className="text-[10px] font-bold truncate" style={{ color: isActive ? primaryColor : "#5a8ab0" }}>
                                                        {preset.primary_page_name}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {subPathUrl && <img src={subPathUrl} alt="" className="w-2.5 h-2.5 object-contain opacity-70" onError={e => { e.target.style.display = "none"; }} />}
                                                    <span className="text-[9px] text-[#3a5a80] truncate">+ {preset.sub_page_name}</span>
                                                </div>
                                            </div>
                                            {switchingPreset && isActive && (
                                                <Loader2 className="w-3 h-3 text-blue-400 animate-spin ml-auto shrink-0" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {runeTreeData ? (
                            <RuneTree {...runeTreeData} runeData={runeData} />
                        ) : (
                            <div className="flex items-center justify-center h-32 text-[#2a4060] text-xs">
                                {importResult.runes_imported ? <Loader2 className="w-4 h-4 text-[#3a6080] animate-spin" /> : "Dati rune non disponibili"}
                            </div>
                        )}
                    </div>

                    {/* RIGHT COLUMN */}
                    <div className="md:col-span-2 flex flex-col gap-4">

                        {/* Summoner Spells */}
                        <div className="rounded-xl border border-[#1a3558] bg-[#070f1e] p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-xs font-bold text-[#5a8ab0] uppercase tracking-widest flex items-center gap-1.5">
                                    <Zap className="w-3.5 h-3.5 text-yellow-400" /> Summoner Spells
                                </h4>
                                {importResult.summoners_imported
                                    ? <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Importati</span>
                                    : <span className="text-red-400 text-xs flex items-center gap-1"><XCircle className="w-3 h-3" /> Fallito</span>}
                            </div>
                            {importResult.summoners_imported && importResult.summoner_spells?.length > 0 ? (
                                <div className="flex gap-4">
                                    {importResult.summoner_spells.slice(0, 2).map((s, i) => (
                                        <div key={i} className="flex flex-col items-center gap-1.5">
                                            <div className="w-14 h-14 rounded-xl overflow-hidden border border-[#1a3558] bg-[#0a1525]">
                                                <img src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/spell/${spellToDDragon(s)}.png`}
                                                    alt={s} className="w-full h-full object-cover" onError={e => { e.target.style.display = "none"; }} />
                                            </div>
                                            <span className="text-[#8ab0cc] text-xs">{s.replace(/^Summoner/, "")}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-[#3a6080] text-xs">Nessun summoner spell importato</p>
                            )}
                        </div>

                        {/* Item Set */}
                        <div className="rounded-xl border border-[#1a3558] bg-[#070f1e] p-4 flex-1">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-xs font-bold text-[#5a8ab0] uppercase tracking-widest flex items-center gap-1.5">
                                    <Package className="w-3.5 h-3.5 text-orange-400" /> Item Set
                                </h4>
                                {importResult.items_imported
                                    ? <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Importato</span>
                                    : <span className="text-red-400 text-xs flex items-center gap-1"><XCircle className="w-3 h-3" /> Fallito</span>}
                            </div>
                            {importResult.items_imported ? (
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-900/40 to-[#0a1525] border border-orange-700/30 flex items-center justify-center shrink-0">
                                        <Package className="w-6 h-6 text-orange-400" />
                                    </div>
                                    <div>
                                        <p className="text-white text-sm font-semibold">Build importata</p>
                                        <p className="text-[#5a8ab0] text-xs">Disponibile nel client LoL</p>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-[#3a6080] text-xs">Item set non importato</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* LANE SELECTOR (URF/ARAM) */}
            {importResult?.available_lanes?.length > 0 && (
                <div className="rounded-xl border border-[#1a3558] bg-[#070f1e] p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-bold text-[#5a8ab0] uppercase tracking-widest">Rune per posizione</h3>
                        <span className="text-[#5a7a98] text-xs">Clicca per importare le rune della lane</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                        {importResult.available_lanes.filter(lane => (lane.play ?? 0) >= 100).map((lane) => {
                            const isActiveLane = (activeRuneLane ?? importResult.active_rune_lane) === lane.lane;
                            return (
                                <button key={lane.lane} disabled={switchingLane} onClick={() => switchRuneLane(lane.lane)}
                                    className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all
                                        ${isActiveLane ? "border-[#1e6fff] bg-[#0a1e4a]/70" : "border-[#1a3558] bg-[#0a1525]/60 hover:border-[#244570]"}
                                        ${switchingLane ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                                    {isActiveLane && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#1e6fff]" />}
                                    <span className={`text-[10px] font-bold uppercase ${isActiveLane ? "text-[#4fc3f7]" : "text-[#7aa8c8]"}`}>{lane.lane}</span>
                                    <LaneKeystone runeId={lane.primary_rune_ids?.[0]} runeMap={runeData.runeMap} />
                                    <div className="text-center">
                                        <p className={`text-[10px] font-semibold ${isActiveLane ? "text-white" : "text-[#a0c4dc]"}`}>{lane.primary_page_name}</p>
                                        <p className="text-[9px] text-[#6a8aa8]">+ {lane.sub_page_name}</p>
                                    </div>
                                    {/* Win rate + play count */}
                                    {lane.win_rate > 0 && (
                                        <div className="flex flex-col items-center gap-0.5">
                                            <span className={`text-[11px] font-bold ${lane.win_rate >= 0.52 ? "text-[#4ade80]" : lane.win_rate >= 0.48 ? "text-[#facc15]" : "text-[#f87171]"}`}>
                                                {(lane.win_rate * 100).toFixed(1)}%
                                            </span>
                                            <span className="text-[9px] text-[#6a8aa8]">{lane.play?.toLocaleString()} partite</span>
                                        </div>
                                    )}
                                    {lane.summoner_spells?.length >= 2 && (
                                        <div className="flex gap-1">
                                            {lane.summoner_spells.slice(0, 2).map((s, i) => (
                                                <img key={i} src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/spell/${spellToDDragon(s)}.png`}
                                                    alt={s} className="w-5 h-5 rounded object-cover" onError={e => { e.target.style.display = "none"; }} />
                                            ))}
                                        </div>
                                    )}
                                    {switchingLane && !isActiveLane && (
                                        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-[#070f1e]/60">
                                            <Loader2 className="w-4 h-4 text-[#4fc3f7] animate-spin" />
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Error */}
            {status === STATUS.ERROR && lastError && (
                <div className="rounded-xl border border-red-800/50 bg-red-950/30 p-4 flex items-start gap-3">
                    <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-red-300 text-sm font-semibold">Errore durante l'importazione</p>
                        <p className="text-red-500 text-xs mt-1 font-mono">{lastError}</p>
                    </div>
                </div>
            )}
        </div>
    );
}