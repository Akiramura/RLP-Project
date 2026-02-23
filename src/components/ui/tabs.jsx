import { createContext, useContext, useState } from "react";

const TabsContext = createContext();

export function Tabs({ defaultValue, value, onValueChange, children, className = "" }) {
    const [internalTab, setInternalTab] = useState(defaultValue);

    // Controlled mode if value is provided, otherwise uncontrolled
    const activeTab = value !== undefined ? value : internalTab;
    const setActiveTab = (tab) => {
        if (onValueChange) onValueChange(tab);
        if (value === undefined) setInternalTab(tab);
    };

    return (
        <TabsContext.Provider value={{ activeTab, setActiveTab }}>
            <div className={className}>{children}</div>
        </TabsContext.Provider>
    );
}

export function TabsList({ children, className = "" }) {
    return <div className={`flex flex-wrap gap-1 ${className}`}>{children}</div>;
}

export function TabsTrigger({ value, children, className = "" }) {
    const { activeTab, setActiveTab } = useContext(TabsContext);
    const isActive = activeTab === value;

    return (
        <button
            onClick={() => setActiveTab(value)}
            className={`${className} flex items-center px-4 py-2 rounded text-sm font-medium transition-all relative
                ${isActive
                    ? "bg-[#1e6fff] text-white shadow-[0_0_12px_rgba(79,195,247,0.3)]"
                    : "bg-[#0d1f38] text-[#5a8ab0] hover:text-white hover:bg-[#142545]"
                }`}
        >
            {children}
        </button>
    );
}

export function TabsContent({ value, children, keepMounted = false }) {
    const { activeTab } = useContext(TabsContext);
    const isActive = value === activeTab;

    if (!keepMounted && !isActive) return null;

    return (
        <div style={keepMounted && !isActive ? { display: "none" } : undefined}>
            {children}
        </div>
    );
}