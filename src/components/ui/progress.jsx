// src/components/ui/progress.jsx
export function Progress({ value = 0, className = "" }) {
    return (
        <div className={`w-full bg-[#0d1f38] rounded-full h-2 ${className}`}>
            <div
                className="bg-[#1e6fff] h-2 rounded-full transition-all"
                style={{ width: `${value}%` }}
            />
        </div>
    );
}