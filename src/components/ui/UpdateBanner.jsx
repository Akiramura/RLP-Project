import { createPortal } from "react-dom";
import { Download, X, RefreshCw, CheckCircle2 } from "lucide-react";

export function UpdateBanner({ status, info, progress, onUpdate, onDismiss }) {
    if (status === "idle") return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] pointer-events-none">

            {/* Backdrop */}
            {status === "available" ? (
                <div
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto"
                    onClick={onDismiss}
                />
            ) : (
                <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            )}

            {/* Card — centrato con transform */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] pointer-events-auto animate-in fade-in zoom-in-95 duration-300">

                {/* Outer glow */}
                <div className="absolute inset-0 rounded-xl bg-[#1e6fff]/10 blur-2xl pointer-events-none" />

                <div className="relative rounded-xl border border-[#1e6fff]/40 bg-[#040c1a] shadow-[0_0_50px_rgba(30,111,255,0.2)] overflow-hidden">

                    {/* Top accent */}
                    <div className="h-px w-full bg-gradient-to-r from-transparent via-[#4fc3f7] to-transparent" />

                    {/* Corner marks */}
                    <span className="absolute top-2 left-2 w-2.5 h-2.5 border-t border-l border-[#4fc3f7]/60 pointer-events-none" />
                    <span className="absolute top-2 right-2 w-2.5 h-2.5 border-t border-r border-[#4fc3f7]/60 pointer-events-none" />
                    <span className="absolute bottom-2 left-2 w-2.5 h-2.5 border-b border-l border-[#4fc3f7]/60 pointer-events-none" />
                    <span className="absolute bottom-2 right-2 w-2.5 h-2.5 border-b border-r border-[#4fc3f7]/60 pointer-events-none" />

                    <div className="p-6">

                        {/* Header */}
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                {status === "done" ? (
                                    <CheckCircle2 className="w-5 h-5 text-[#00e5a0] shrink-0" />
                                ) : status === "downloading" ? (
                                    <Download className="w-5 h-5 text-[#4fc3f7] shrink-0 animate-bounce" />
                                ) : (
                                    <RefreshCw className="w-5 h-5 text-[#4fc3f7] shrink-0" />
                                )}
                                <span className="text-[10px] font-mono tracking-[0.2em] text-[#4fc3f7]/70 uppercase">
                                    {status === "done"
                                        ? "[ RESTARTING ]"
                                        : status === "downloading"
                                            ? "[ DOWNLOADING ]"
                                            : "[ UPDATE AVAILABLE ]"}
                                </span>
                            </div>
                            {status === "available" && (
                                <button
                                    onClick={onDismiss}
                                    className="text-[#3a6080] hover:text-[#5a8ab0] transition-colors p-0.5 ml-2"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>

                        {/* Version info */}
                        {info && status !== "done" && (
                            <div className="mb-4">
                                <p className="text-white font-mono font-bold text-lg tracking-wider">
                                    RLP <span className="text-[#4fc3f7]">v{info.version}</span>
                                </p>
                                {info.body && (
                                    <p className="text-[#5a8ab0] text-sm mt-1.5 leading-relaxed">
                                        {info.body}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Done state */}
                        {status === "done" && (
                            <p className="text-[#00e5a0] font-mono text-base mb-4 tracking-wide">
                                Installation complete. Restarting...
                            </p>
                        )}

                        {/* Download progress bar */}
                        {status === "downloading" && (
                            <div className="mb-4">
                                <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[#3a6080] text-xs font-mono">Downloading</span>
                                    <span className="text-[#4fc3f7] text-xs font-mono">{Math.round(progress)}%</span>
                                </div>
                                <div className="h-1.5 bg-[#0d1f38] rounded-full overflow-hidden">
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

                        {/* Relaunch progress bar */}
                        {status === "done" && (
                            <div className="mb-4">
                                <div className="h-1.5 bg-[#0d1f38] rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full"
                                        style={{ width: "100%", background: "linear-gradient(90deg, #00e5a0, #4fc3f7)" }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Action buttons */}
                        {status === "available" && (
                            <div className="flex gap-2 mt-2">
                                <button
                                    onClick={onUpdate}
                                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#1e6fff] hover:bg-[#1459d4] text-white text-sm font-mono font-bold tracking-wider transition-all hover:shadow-[0_0_16px_rgba(30,111,255,0.4)] active:scale-95"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    UPDATE NOW
                                </button>
                                <button
                                    onClick={onDismiss}
                                    className="py-2.5 px-4 rounded-lg border border-[#1a3558] text-[#5a8ab0] hover:text-white hover:border-[#244570] text-sm font-mono tracking-wider transition-colors"
                                >
                                    LATER
                                </button>
                            </div>
                        )}

                    </div>

                    {/* Bottom accent */}
                    <div className="h-px w-full bg-gradient-to-r from-transparent via-[#1e6fff]/40 to-transparent" />

                </div>
            </div>
        </div>,
        document.body
    );
}