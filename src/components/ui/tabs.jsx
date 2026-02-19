import { createContext, useContext, useState } from "react";

const TabsContext = createContext();

export function Tabs({ defaultValue, children, className = "" }) {
    const [activeTab, setActiveTab] = useState(defaultValue);

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

export function TabsContent({ value, children }) {
    const { activeTab } = useContext(TabsContext);
    if (value !== activeTab) return null;
    return <div>{children}</div>;
}
