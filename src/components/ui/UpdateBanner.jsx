// Sostituisci il blocco useEffect del updater in App.jsx con questo:
// 1. Aggiungi questo componente in fondo al file (prima dell'ultima riga)
// 2. Sostituisci il useEffect checkForUpdates con quello qui sotto
// 3. Aggiungi i nuovi stati: updateInfo, updateProgress, updateStatus
// 4. Aggiungi <UpdateBanner ... /> dentro il return, subito prima di </div> finale

// ─── NUOVI STATI da aggiungere dentro App() ───────────────────────────────────
//
//   const [updateInfo, setUpdateInfo]       = useState(null);   // { version, body }
//   const [updateStatus, setUpdateStatus]   = useState("idle"); // "idle"|"available"|"downloading"|"done"
//   const [updateProgress, setUpdateProgress] = useState(0);
//   const updateRef = useRef(null);
//
// ─── SOSTITUISCI il useEffect checkForUpdates con questo ──────────────────────

/*
useEffect(() => {
    async function checkForUpdates() {
        try {
            const update = await check();
            if (update?.available) {
                updateRef.current = update;
                setUpdateInfo({ version: update.version, body: update.body ?? "" });
                setUpdateStatus("available");
            }
        } catch (e) {
            console.error("[Updater] Errore:", e);
        }
    }
    checkForUpdates();
}, []);
*/

// ─── AGGIUNGI queste due funzioni dentro App() ────────────────────────────────

/*
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
*/

// ─── AGGIUNGI <UpdateBanner /> nel return, subito prima del </div> finale ─────
// <UpdateBanner
//     status={updateStatus}
//     info={updateInfo}
//     progress={updateProgress}
//     onUpdate={handleUpdate}
//     onDismiss={handleDismissUpdate}
// />

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

import { Download, X, RefreshCw, CheckCircle2 } from "lucide-react";

export function UpdateBanner({ status, info, progress, onUpdate, onDismiss }) {
    if (status === "idle") return null;

    return (
        <div className="fixed bottom-6 right-6 z-[9999] w-80 animate-in slide-in-from-bottom-4 duration-300">
            {/* Outer glow */}
            <div className="absolute inset-0 rounded-lg bg-[#1e6fff]/10 blur-xl pointer-events-none" />

            <div className="relative rounded-lg border border-[#1e6fff]/40 bg-[#040c1a]/95 backdrop-blur-sm shadow-[0_0_30px_rgba(30,111,255,0.15)] overflow-hidden">

                {/* Top accent line */}
                <div className="h-px w-full bg-gradient-to-r from-transparent via-[#4fc3f7] to-transparent" />

                {/* Corner marks */}
                <span className="absolute top-2 left-2 w-2 h-2 border-t border-l border-[#4fc3f7]/60" />
                <span className="absolute top-2 right-2 w-2 h-2 border-t border-r border-[#4fc3f7]/60" />
                <span className="absolute bottom-2 left-2 w-2 h-2 border-b border-l border-[#4fc3f7]/60" />
                <span className="absolute bottom-2 right-2 w-2 h-2 border-b border-r border-[#4fc3f7]/60" />

                <div className="p-4">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                            {status === "done" ? (
                                <CheckCircle2 className="w-4 h-4 text-[#00e5a0] shrink-0" />
                            ) : status === "downloading" ? (
                                <Download className="w-4 h-4 text-[#4fc3f7] shrink-0 animate-bounce" />
                            ) : (
                                <RefreshCw className="w-4 h-4 text-[#4fc3f7] shrink-0" />
                            )}
                            <span className="text-[9px] font-mono tracking-[0.2em] text-[#4fc3f7]/70 uppercase">
                                {status === "done" ? "[ RIAVVIO IN CORSO ]" :
                                 status === "downloading" ? "[ DOWNLOAD IN CORSO ]" :
                                 "[ AGGIORNAMENTO DISPONIBILE ]"}
                            </span>
                        </div>
                        {status === "available" && (
                            <button
                                onClick={onDismiss}
                                className="text-[#3a6080] hover:text-[#5a8ab0] transition-colors p-0.5"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Version info */}
                    {info && status !== "done" && (
                        <div className="mb-3">
                            <p className="text-white font-mono font-bold text-sm tracking-wider">
                                RLP <span className="text-[#4fc3f7]">v{info.version}</span>
                            </p>
                            {info.body && (
                                <p className="text-[#3a6080] text-xs mt-1 leading-relaxed line-clamp-2">
                                    {info.body}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Done state */}
                    {status === "done" && (
                        <p className="text-[#00e5a0] font-mono text-sm mb-3 tracking-wide">
                            Installazione completata
                        </p>
                    )}

                    {/* Progress bar */}
                    {status === "downloading" && (
                        <div className="mb-3">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[#3a6080] text-xs font-mono">Download</span>
                                <span className="text-[#4fc3f7] text-xs font-mono">{Math.round(progress)}%</span>
                            </div>
                            <div className="h-1 bg-[#0d1f38] rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                        width: `${progress}%`,
                                        background: "linear-gradient(90deg, #1e6fff, #4fc3f7)"
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Relaunch progress */}
                    {status === "done" && (
                        <div className="mb-3">
                            <div className="h-1 bg-[#0d1f38] rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full"
                                    style={{
                                        width: "100%",
                                        background: "linear-gradient(90deg, #00e5a0, #4fc3f7)"
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Action buttons */}
                    {status === "available" && (
                        <div className="flex gap-2">
                            <button
                                onClick={onUpdate}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded bg-[#1e6fff] hover:bg-[#1459d4] text-white text-xs font-mono font-bold tracking-wider transition-all hover:shadow-[0_0_12px_rgba(30,111,255,0.4)] active:scale-95"
                            >
                                <Download className="w-3 h-3" />
                                AGGIORNA
                            </button>
                            <button
                                onClick={onDismiss}
                                className="py-2 px-3 rounded border border-[#1a3558] text-[#5a8ab0] hover:text-white hover:border-[#244570] text-xs font-mono tracking-wider transition-colors"
                            >
                                DOPO
                            </button>
                        </div>
                    )}
                </div>

                {/* Bottom accent line */}
                <div className="h-px w-full bg-gradient-to-r from-transparent via-[#1e6fff]/40 to-transparent" />
            </div>
        </div>
    );
}
