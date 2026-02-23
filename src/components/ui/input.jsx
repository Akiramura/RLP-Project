export function Input({ className = "", ...props }) {
    return (
        <input
            {...props}
            className={`px-3 py-2 rounded bg-[#0d1f38] border border-[#1a3558] text-white placeholder:text-[#3a6080] outline-none focus:border-[#4fc3f7] focus:ring-1 focus:ring-[#4fc3f7]/30 transition-colors ${className}`}
        />
    );
}