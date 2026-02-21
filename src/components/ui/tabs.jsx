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
    return <div className={className}>{children}</div>;
}

export function TabsTrigger({ value, children, className = "" }) {
    const { activeTab, setActiveTab } = useContext(TabsContext);
    const isActive = activeTab === value;

    return (
        <button
            onClick={() => setActiveTab(value)}
            className={`${className} px-4 py-2 rounded ${isActive ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"
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