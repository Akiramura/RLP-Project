import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Shield, Zap, Package, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { PATCH } from "./constants";


// Converte i nomi grezzi da OP.GG (es. "Flash", "Heal") nel nome DDragon corretto
const SPELL_NAME_MAP = {
    flash: "SummonerFlash",
    ignite: "SummonerDot",
    teleport: "SummonerTeleport",
    barrier: "SummonerBarrier",
    exhaust: "SummonerExhaust",
    ghost: "SummonerHaste",
    heal: "SummonerHeal",
    cleanse: "SummonerBoost",
    smite: "SummonerSmite",
    clarity: "SummonerMana",
    mark: "SummonerSnowball",
};

function spellToDDragon(name) {
    if (!name) return name;
    // Se già ha il prefisso "Summoner" lo usiamo direttamente
    if (name.toLowerCase().startsWith("summoner")) return name;
    return SPELL_NAME_MAP[name.toLowerCase()] ?? name;
}

const STATUS = {
    IDLE: "idle",
    DETECTING: "detecting",
    FOUND: "found",
    FETCHING: "fetching",
    IMPORTING: "importing",
    DONE: "done",
    ERROR: "error",
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
                ${error ? "text-red-300" :
                    done ? "text-green-300" :
                        active ? "text-[#a8e4ff]" : "text-[#3a6080]"}`}>
                {label}
            </span>
        </div>
    );
}

export function ChampSelectTab() {
    const [status, setStatus] = useState(STATUS.IDLE);
    const [champData, setChampData] = useState(null);   // { championName, lane, position }
    const [importResult, setImportResult] = useState(null); // { runes, summoners, items, errors[] }
    const [log, setLog] = useState([]);
    const [lastError, setLastError] = useState(null);
    const pollRef = useRef(null);
    const importingRef = useRef(false);
    const lastChampRef = useRef(null);

    function addLog(msg) {
        const ts = new Date().toLocaleTimeString("it-IT");
        const line = `[${ts}] ${msg}`;
        console.debug("[RLP champ-select]", line);
        setLog(prev => [line, ...prev].slice(0, 30));
    }

    // Poll every 2.5s
    useEffect(() => {
        pollRef.current = setInterval(poll, 2500);
        poll(); // immediate first call
        return () => clearInterval(pollRef.current);
    }, []);

    async function poll() {
        try {
            const session = await invoke("get_champ_select_session");
            if (!session || !session.in_progress) {
                if (!importingRef.current) {
                    setStatus(STATUS.DETECTING);
                    // Reset se era done/error e non c'è più champ select
                    if (status === STATUS.DONE || status === STATUS.ERROR) {
                        setStatus(STATUS.DETECTING);
                        setChampData(null);
                        setImportResult(null);
                        lastChampRef.current = null;
                        importingRef.current = false;
                    }
                }
                return;
            }

            // Aspetta che il campione sia stato selezionato/hoverato
            if (!session.champion_name) return;

            const key = `${session.champion_name}_${session.assigned_position}_${session.game_mode ?? "ranked"}`;
            if (lastChampRef.current === key) return; // già importato per questo campione+lane+mode
            lastChampRef.current = key;

            setChampData(session);
            setStatus(STATUS.FOUND);
            addLog(`Rilevato: ${session.champion_name} (${session.assigned_position || "fill"})`);
            runImport(session);
        } catch (e) {
            if (status !== STATUS.IDLE && status !== STATUS.DETECTING) return;
            setStatus(STATUS.DETECTING);
        }
    }

    async function runImport(session) {
        if (importingRef.current) return;
        importingRef.current = true;
        setLastError(null);
        setImportResult(null);

        try {
            setStatus(STATUS.FETCHING);
            addLog(`Scarico build RLP per ${session.champion_name} ${session.assigned_position}...`);

            const result = await invoke("auto_import_build", {
                championName: session.champion_name,
                assignedPosition: session.assigned_position || "DEFAULT",
                gameMode: session.game_mode || "ranked",
            });

            setImportResult(result);
            if (result.errors && result.errors.length > 0) {
                setStatus(STATUS.ERROR);
                console.error("[RLP import] Errors:", result.errors.join("; "));
                addLog(`Errori: ${result.errors.join(", ")}`);
            } else {
                setStatus(STATUS.DONE);
                addLog("✓ Rune, summoners e item set importati!");
            }
        } catch (e) {
            setStatus(STATUS.ERROR);
            console.error("[RLP auto-import] Error:", e);
            addLog(`Errore: ${e}`);
        } finally {
            importingRef.current = false;
        }
    }

    const isActive = (s) => status === s;
    const isDone = (s) => {
        const order = [STATUS.DETECTING, STATUS.FOUND, STATUS.FETCHING, STATUS.IMPORTING, STATUS.DONE];
        return order.indexOf(status) > order.indexOf(s);
    };
    const isError = (s) => status === STATUS.ERROR && s === STATUS.IMPORTING;

    return (
        <div className="space-y-6">

            {/* Status header */}
            <Card className="p-6 bg-gradient-to-br from-[#070f1e] to-[#0d1f38] border-[#0a1e4a]">
                <div className="flex items-center gap-4">
                    {/* Champion icon or placeholder */}
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
                        {/* lastError logged to console only */}
                    </div>
                </div>
            </Card>

            {/* Steps */}
            <Card className="p-4 bg-[#070f1e] border-[#1a3558]">
                <h3 className="text-sm font-semibold text-[#5a8ab0] uppercase tracking-wider mb-3">
                    Stato importazione
                </h3>
                <div className="space-y-1">
                    <StepRow icon={Shield} label="Rilevamento champion select"
                        active={isActive(STATUS.DETECTING) || isActive(STATUS.FOUND)}
                        done={isDone(STATUS.DETECTING)} />
                    <StepRow icon={Zap} label="Recupero build..."
                        active={isActive(STATUS.FETCHING)}
                        done={isDone(STATUS.FETCHING)} />
                    <StepRow icon={Package} label="Importazione rune / summoners / item set"
                        active={isActive(STATUS.IMPORTING)}
                        done={isDone(STATUS.IMPORTING)}
                        error={isError(STATUS.IMPORTING)} />
                    <StepRow icon={CheckCircle} label="Build attiva nel client"
                        active={false}
                        done={status === STATUS.DONE} />
                </div>
            </Card>

            {/* Result detail */}
            {importResult && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                    {/* Rune */}
                    <Card className="p-4 bg-[#070f1e] border-[#1a3558]">
                        <h4 className="text-[#b8d4e8] font-semibold mb-3 flex items-center gap-2">
                            <Shield className="w-4 h-4 text-purple-400" /> Rune
                        </h4>
                        {importResult.runes_imported ? (
                            <div className="space-y-1">
                                <p className="text-green-400 text-sm">✓ Importate</p>
                                {importResult.rune_page_name && (
                                    <p className="text-[#5a8ab0] text-xs">{importResult.rune_page_name}</p>
                                )}
                                {importResult.primary_path && (
                                    <p className="text-[#8ab0cc] text-xs capitalize">{importResult.primary_path}</p>
                                )}
                            </div>
                        ) : (
                            <p className="text-red-400 text-sm">✗ Non importate</p>
                        )}
                    </Card>

                    {/* Summoners */}
                    <Card className="p-4 bg-[#070f1e] border-[#1a3558]">
                        <h4 className="text-[#b8d4e8] font-semibold mb-3 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-yellow-400" /> Summoner Spells
                        </h4>
                        {importResult.summoners_imported ? (
                            <div className="flex gap-2 mt-1">
                                {importResult.summoner_spells?.map((s, i) => (
                                    <div key={i} className="text-center">
                                        <img
                                            src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/spell/${spellToDDragon(s)}.png`}
                                            alt={s}
                                            className="w-10 h-10 rounded object-cover"
                                            onError={e => { e.target.style.display = "none"; }}
                                        />
                                        <p className="text-[#5a8ab0] text-xs mt-1">{s}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-red-400 text-sm">✗ Non importate</p>
                        )}
                    </Card>

                    {/* Items */}
                    <Card className="p-4 bg-[#070f1e] border-[#1a3558]">
                        <h4 className="text-[#b8d4e8] font-semibold mb-3 flex items-center gap-2">
                            <Package className="w-4 h-4 text-orange-400" /> Item Set
                        </h4>
                        {importResult.items_imported ? (
                            <div className="space-y-1">
                                <p className="text-green-400 text-sm">✓ Importato</p>
                                {/*{importResult.item_blocks && (*/}
                                {/*    <p className="text-[#5a8ab0] text-xs">{importResult.item_blocks} blocchi</p>*/}
                                {/*)}*/}
                            </div>
                        ) : (
                            <p className="text-red-400 text-sm">✗ Non importato</p>
                        )}
                    </Card>
                </div>
            )}

            {/* Log box: dev only — hidden from UI */}

        </div>
    );
}