// src/components/ui/card.jsx
export function Card({ children, className = "" }) {
    return (
        <div className={`rounded-lg shadow-sm bg-slate-900 border border-slate-800 ${className}`}>
            {children}
        </div>
    );
}