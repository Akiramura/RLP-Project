// src/components/ui/badge.jsx
export function Badge({ children, className = "" }) {
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}
        >
            {children}
        </span>
    );
}