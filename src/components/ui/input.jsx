export function Input({ className = "", ...props }) {
    return (
        <input
            {...props}
            className={`px-3 py-2 rounded bg-slate-800 border border-slate-700 text-white outline-none ${className}`}
        />
    );
}
