// src/components/ui/card.jsx
export function Card({ children, className = "" }) {
    return (
        <div className={`rounded-lg shadow-lg bg-[#070f1e] border border-[#0f2040] ${className}`}>
            {children}
        </div>
    );
}