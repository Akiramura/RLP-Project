export function Button({ children, className = "", ...props }) {
    return (
        <button
            {...props}
            className={`px-4 py-2 rounded bg-[#1e6fff] hover:bg-[#1459d4] text-white font-medium transition-colors ${className}`}
        >
            {children}
        </button>
    );
}