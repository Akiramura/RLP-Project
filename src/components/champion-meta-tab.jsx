import { useState, useMemo } from "react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { TrendingUp, Swords, Trophy, Target, Zap, AlertTriangle, Filter } from "lucide-react";

const PATCH = "16.4.1";

// Patch 14.24 iniziata il 27 Novembre 2024, 14.1 (Season 2025) il 8 Gennaio 2025
const PATCH_SCHEDULE = [
    { patch: "26.01", from: new Date("2026-01-08T00:00:00Z").getTime(), to: new Date("2026-01-22T00:00:00Z").getTime() },
    { patch: "26.02", from: new Date("2026-01-22T00:00:00Z").getTime(), to: new Date("2026-02-04T00:00:00Z").getTime() },
    { patch: "26.03", from: new Date("2026-02-04T00:00:00Z").getTime(), to: new Date("2026-02-19T00:00:00Z").getTime() },
    { patch: "26.04", from: new Date("2026-02-19T00:00:00Z").getTime(), to: new Date("2026-03-04T00:00:00Z").getTime() },
    { patch: "26.05", from: new Date("2026-03-04T00:00:00Z").getTime(), to: new Date("2026-03-18T00:00:00Z").getTime() },
    { patch: "26.06", from: new Date("2026-03-18T00:00:00Z").getTime(), to: new Date("2026-04-01T00:00:00Z").getTime() },
    { patch: "26.07", from: new Date("2026-04-01T00:00:00Z").getTime(), to: new Date("2026-04-15T00:00:00Z").getTime() },
    { patch: "26.08", from: new Date("2026-04-15T00:00:00Z").getTime(), to: new Date("2026-04-29T00:00:00Z").getTime() },
    { patch: "26.09", from: new Date("2026-04-29T00:00:00Z").getTime(), to: new Date("2026-05-13T00:00:00Z").getTime() },
    { patch: "26.10", from: new Date("2026-05-13T00:00:00Z").getTime(), to: new Date("2026-05-28T00:00:00Z").getTime() },
    { patch: "26.11", from: new Date("2026-05-28T00:00:00Z").getTime(), to: new Date("2026-06-10T00:00:00Z").getTime() },
    { patch: "26.12", from: new Date("2026-06-10T00:00:00Z").getTime(), to: new Date("2026-06-24T00:00:00Z").getTime() },
    { patch: "26.13", from: new Date("2026-06-24T00:00:00Z").getTime(), to: new Date("2026-07-15T00:00:00Z").getTime() },
    { patch: "26.14", from: new Date("2026-07-15T00:00:00Z").getTime(), to: new Date("2026-07-29T00:00:00Z").getTime() },
    { patch: "26.15", from: new Date("2026-07-29T00:00:00Z").getTime(), to: new Date("2026-08-12T00:00:00Z").getTime() },
    { patch: "26.16", from: new Date("2026-08-12T00:00:00Z").getTime(), to: new Date("2026-08-26T00:00:00Z").getTime() },
    { patch: "26.17", from: new Date("2026-08-26T00:00:00Z").getTime(), to: new Date("2026-09-10T00:00:00Z").getTime() },
    { patch: "26.18", from: new Date("2026-09-10T00:00:00Z").getTime(), to: new Date("2026-09-23T00:00:00Z").getTime() },
    { patch: "26.19", from: new Date("2026-09-23T00:00:00Z").getTime(), to: new Date("2026-10-07T00:00:00Z").getTime() },
    { patch: "26.20", from: new Date("2026-10-07T00:00:00Z").getTime(), to: new Date("2026-10-21T00:00:00Z").getTime() },
    { patch: "26.21", from: new Date("2026-10-21T00:00:00Z").getTime(), to: new Date("2026-11-04T00:00:00Z").getTime() },
    { patch: "26.22", from: new Date("2026-11-04T00:00:00Z").getTime(), to: new Date("2026-11-18T00:00:00Z").getTime() },
    { patch: "26.23", from: new Date("2026-11-18T00:00:00Z").getTime(), to: new Date("2026-12-09T00:00:00Z").getTime() },
    { patch: "26.24", from: new Date("2026-12-09T00:00:00Z").getTime(), to: Infinity },
];

// Determina la patch corrente automaticamente
const now = Date.now();
const currentPatch = PATCH_SCHEDULE.find(p => now >= p.from && now < p.to) || PATCH_SCHEDULE[0];

const FILTER_OPTIONS = [
    { label: "Season 2026", key: "season", from: new Date("2026-01-08T00:00:00Z").getTime() },
    { label: `Patch ${currentPatch.patch}`, key: "patch", from: currentPatch.from, to: currentPatch.to },
    { label: "Tutte le partite", key: "all", from: 0 },
];

const META_DATA = {
    "Ahri": { tier: "S+", metaWR: 52.40, metaGames: 31360 },
    "Jinx": { tier: "S+", metaWR: 51.96, metaGames: 34588 },
    "Nami": { tier: "S+", metaWR: 52.12, metaGames: 30426 },
    "RekSai": { tier: "S+", metaWR: 53.04, metaGames: 5726 },
    "Singed": { tier: "S+", metaWR: 53.96, metaGames: 6392 },
    "Sona": { tier: "S+", metaWR: 52.61, metaGames: 10483 },
    "KhaZix": { tier: "S+", metaWR: 51.28, metaGames: 25102 },
    "Akshan": { tier: "S+", metaWR: 52.72, metaGames: 6202 },
    "Ekko": { tier: "S", metaWR: 52.58, metaGames: 10330 },
    "Thresh": { tier: "S", metaWR: 51.76, metaGames: 30089 },
    "Jhin": { tier: "S-", metaWR: 50.62, metaGames: 31857 },
    "Bard": { tier: "S", metaWR: 51.21, metaGames: 14820 },
    "Kayle": { tier: "S", metaWR: 53.28, metaGames: 8104 },
    "Elise": { tier: "S", metaWR: 52.08, metaGames: 5380 },
    "Katarina": { tier: "S", metaWR: 51.25, metaGames: 15170 },
    "LeeSin": { tier: "S-", metaWR: 50.23, metaGames: 25296 },
    "Xayah": { tier: "A+", metaWR: 52.06, metaGames: 13255 },
    "Zaahen": { tier: "S", metaWR: 50.49, metaGames: 12729 },
    "Gangplank": { tier: "S-", metaWR: 51.27, metaGames: 11016 },
    "Braum": { tier: "S-", metaWR: 51.25, metaGames: 16997 },
    "MissFortune": { tier: "A", metaWR: 51.47, metaGames: 17922 },
    "Ornn": { tier: "S-", metaWR: 52.76, metaGames: 11706 },
    "Neeko": { tier: "A+", metaWR: 50.82, metaGames: 6985 },
    "Leona": { tier: "A+", metaWR: 51.67, metaGames: 16587 },
    "Shen": { tier: "S-", metaWR: 52.59, metaGames: 8087 },
    "Zoe": { tier: "S-", metaWR: 51.13, metaGames: 7816 },
    "Ivern": { tier: "A+", metaWR: 53.09, metaGames: 2392 },
    "XinZhao": { tier: "A+", metaWR: 51.51, metaGames: 15165 },
    "Zilean": { tier: "A+", metaWR: 52.23, metaGames: 6255 },
    "Aatrox": { tier: "S-", metaWR: 50.24, metaGames: 15926 },
    "Smolder": { tier: "A", metaWR: 51.30, metaGames: 18662 },
    "Olaf": { tier: "A+", metaWR: 52.02, metaGames: 4821 },
    "KogMaw": { tier: "A-", metaWR: 53.79, metaGames: 4493 },
    "Xerath": { tier: "A+", metaWR: 52.43, metaGames: 10371 },
    "Graves": { tier: "A+", metaWR: 51.54, metaGames: 18803 },
    "Milio": { tier: "A+", metaWR: 51.49, metaGames: 14619 },
    "Nunu": { tier: "A", metaWR: 52.50, metaGames: 5036 },
    "Rakan": { tier: "A+", metaWR: 51.43, metaGames: 9282 },
    "TwistedFate": { tier: "A+", metaWR: 51.87, metaGames: 11916 },
    "Nautilus": { tier: "A", metaWR: 50.21, metaGames: 23231 },
    "Diana": { tier: "A", metaWR: 50.46, metaGames: 10897 },
    "AurelionSol": { tier: "A+", metaWR: 52.39, metaGames: 6282 },
    "Rell": { tier: "A", metaWR: 50.33, metaGames: 5973 },
    "MasterYi": { tier: "A", metaWR: 50.62, metaGames: 10126 },
    "Soraka": { tier: "A", metaWR: 51.79, metaGames: 9935 },
    "Vayne": { tier: "B+", metaWR: 50.79, metaGames: 12603 },
    "Twitch": { tier: "B+", metaWR: 50.51, metaGames: 13576 },
    "Anivia": { tier: "A", metaWR: 52.16, metaGames: 7044 },
    "Seraphine": { tier: "A", metaWR: 51.36, metaGames: 8609 },
    "BelVeth": { tier: "A", metaWR: 50.93, metaGames: 3507 },
    "Shaco": { tier: "A", metaWR: 51.70, metaGames: 8798 },
    "Viktor": { tier: "A", metaWR: 51.10, metaGames: 14207 },
    "KaiSa": { tier: "B+", metaWR: 50.03, metaGames: 41178 },
    "Ambessa": { tier: "A", metaWR: 50.04, metaGames: 10146 },
    "Blitzcrank": { tier: "A", metaWR: 50.93, metaGames: 12053 },
    "Janna": { tier: "A-", metaWR: 51.60, metaGames: 8303 },
    "Caitlyn": { tier: "B+", metaWR: 50.63, metaGames: 36667 },
    "Briar": { tier: "A-", metaWR: 52.11, metaGames: 10182 },
    "Ashe": { tier: "B", metaWR: 50.99, metaGames: 13451 },
    "Lux": { tier: "A-", metaWR: 50.35, metaGames: 11212 },
    "Karma": { tier: "A-", metaWR: 50.08, metaGames: 21063 },
    "Kennen": { tier: "A", metaWR: 50.21, metaGames: 6065 },
    "Malzahar": { tier: "A", metaWR: 51.49, metaGames: 12942 },
    "Nilah": { tier: "B", metaWR: 52.69, metaGames: 3496 },
    "Urgot": { tier: "A", metaWR: 52.54, metaGames: 5607 },
    "Veigar": { tier: "A", metaWR: 51.52, metaGames: 8757 },
    "Kindred": { tier: "A-", metaWR: 51.24, metaGames: 4420 },
    "Samira": { tier: "B", metaWR: 50.93, metaGames: 13979 },
    "Pyke": { tier: "A-", metaWR: 50.30, metaGames: 11989 },
    "Vladimir": { tier: "A-", metaWR: 50.70, metaGames: 5927 },
    "Fiddlesticks": { tier: "A-", metaWR: 52.61, metaGames: 5752 },
    "Zyra": { tier: "A-", metaWR: 51.00, metaGames: 5704 },
    "Maokai": { tier: "A-", metaWR: 52.59, metaGames: 5526 },
    "Quinn": { tier: "A", metaWR: 52.61, metaGames: 1933 },
    "Zed": { tier: "A-", metaWR: 50.03, metaGames: 14431 },
    "Naafiri": { tier: "A-", metaWR: 50.20, metaGames: 8524 },
    "Alistar": { tier: "A-", metaWR: 49.94, metaGames: 10292 },
    "Aphelios": { tier: "B", metaWR: 47.45, metaGames: 18446 },
    "Fizz": { tier: "A-", metaWR: 51.57, metaGames: 8529 },
    "Sivir": { tier: "B-", metaWR: 50.83, metaGames: 14615 },
    "DrMundo": { tier: "A-", metaWR: 50.26, metaGames: 8582 },
    "Brand": { tier: "B+", metaWR: 51.35, metaGames: 5649 },
    "Talon": { tier: "B+", metaWR: 49.94, metaGames: 7637 },
    "Evelynn": { tier: "B+", metaWR: 51.86, metaGames: 4909 },
    "Draven": { tier: "B-", metaWR: 49.67, metaGames: 7614 },
    "Akali": { tier: "A-", metaWR: 50.01, metaGames: 14618 },
    "Kled": { tier: "A-", metaWR: 51.55, metaGames: 3827 },
    "Annie": { tier: "B+", metaWR: 52.75, metaGames: 4296 },
    "Rammus": { tier: "B+", metaWR: 51.56, metaGames: 3431 },
    "Sett": { tier: "A-", metaWR: 51.09, metaGames: 11574 },
    "Riven": { tier: "A-", metaWR: 50.14, metaGames: 8187 },
    "VelKoz": { tier: "B+", metaWR: 51.02, metaGames: 5535 },
    "Zeri": { tier: "C+", metaWR: 49.51, metaGames: 4516 },
    "Vex": { tier: "B+", metaWR: 52.78, metaGames: 6429 },
    "Heimerdinger": { tier: "A-", metaWR: 53.51, metaGames: 2020 },
    "Zac": { tier: "B", metaWR: 49.70, metaGames: 7277 },
    "Qiyana": { tier: "B+", metaWR: 49.14, metaGames: 5667 },
    "Yunara": { tier: "C+", metaWR: 48.23, metaGames: 20097 },
    "Tristana": { tier: "C+", metaWR: 50.28, metaGames: 8169 },
    "JarvanIV": { tier: "B", metaWR: 49.85, metaGames: 12856 },
    "Darius": { tier: "A-", metaWR: 50.42, metaGames: 12621 },
    "Camille": { tier: "B+", metaWR: 50.90, metaGames: 5919 },
    "Lillia": { tier: "B", metaWR: 51.00, metaGames: 6078 },
    "Taric": { tier: "B", metaWR: 50.36, metaGames: 2661 },
    "Ezreal": { tier: "C", metaWR: 49.21, metaGames: 40718 },
    "Renekton": { tier: "B+", metaWR: 50.23, metaGames: 12683 },
    "Poppy": { tier: "B", metaWR: 50.30, metaGames: 3843 },
    "Ziggs": { tier: "C", metaWR: 51.91, metaGames: 3406 },
    "Hecarim": { tier: "B", metaWR: 49.47, metaGames: 8063 },
    "Taliyah": { tier: "B+", metaWR: 50.02, metaGames: 4570 },
    "Rengar": { tier: "B", metaWR: 49.22, metaGames: 8038 },
    "Lulu": { tier: "B", metaWR: 49.59, metaGames: 22641 },
    "Lucian": { tier: "C", metaWR: 49.56, metaGames: 19106 },
    "Corki": { tier: "C-", metaWR: 49.33, metaGames: 7742 },
    "Swain": { tier: "B", metaWR: 47.92, metaGames: 6098 },
    "Gnar": { tier: "B+", metaWR: 51.24, metaGames: 8775 },
    "Mordekaiser": { tier: "B+", metaWR: 51.14, metaGames: 11526 },
    "Sylas": { tier: "B", metaWR: 49.02, metaGames: 15154 },
    "Vi": { tier: "B-", metaWR: 50.52, metaGames: 13666 },
    "Wukong": { tier: "B-", metaWR: 51.65, metaGames: 5574 },
    "Nasus": { tier: "B+", metaWR: 51.38, metaGames: 8124 },
    "Varus": { tier: "D+", metaWR: 48.79, metaGames: 11393 },
    "Morgana": { tier: "B-", metaWR: 50.18, metaGames: 9330 },
    "Kassadin": { tier: "B", metaWR: 49.37, metaGames: 9729 },
    "Nidalee": { tier: "B-", metaWR: 49.96, metaGames: 4484 },
    "Amumu": { tier: "B-", metaWR: 50.93, metaGames: 4585 },
    "Garen": { tier: "B+", metaWR: 50.75, metaGames: 11080 },
    "Senna": { tier: "B-", metaWR: 49.84, metaGames: 12868 },
    "Illaoi": { tier: "B", metaWR: 50.91, metaGames: 4954 },
    "Karthus": { tier: "B-", metaWR: 49.43, metaGames: 3219 },
    "Jayce": { tier: "B", metaWR: 49.91, metaGames: 7720 },
    "Yasuo": { tier: "B", metaWR: 49.76, metaGames: 19064 },
    "Kalista": { tier: "D-", metaWR: 48.12, metaGames: 1893 },
    "Malphite": { tier: "B", metaWR: 50.99, metaGames: 12973 },
    "Kayn": { tier: "B-", metaWR: 49.76, metaGames: 10128 },
    "Viego": { tier: "C+", metaWR: 49.37, metaGames: 27299 },
    "Teemo": { tier: "B", metaWR: 51.23, metaGames: 5198 },
    "Pantheon": { tier: "C+", metaWR: 48.86, metaGames: 6103 },
    "TahmKench": { tier: "C+", metaWR: 49.76, metaGames: 4327 },
    "Sejuani": { tier: "C+", metaWR: 51.07, metaGames: 3977 },
    "Hwei": { tier: "B-", metaWR: 50.50, metaGames: 7847 },
    "Orianna": { tier: "B-", metaWR: 48.00, metaGames: 11169 },
    "Rumble": { tier: "B", metaWR: 48.99, metaGames: 6575 },
    "Sion": { tier: "B", metaWR: 50.61, metaGames: 10256 },
    "Nocturne": { tier: "C+", metaWR: 50.10, metaGames: 7709 },
    "Gragas": { tier: "B", metaWR: 50.14, metaGames: 4362 },
    "Lissandra": { tier: "B-", metaWR: 50.53, metaGames: 6662 },
    "Yuumi": { tier: "C+", metaWR: 47.64, metaGames: 10148 },
    "Fiora": { tier: "B", metaWR: 49.67, metaGames: 7999 },
    "RenataGlasc": { tier: "C", metaWR: 49.33, metaGames: 2173 },
    "Udyr": { tier: "C", metaWR: 49.42, metaGames: 3978 },
    "Syndra": { tier: "B-", metaWR: 49.85, metaGames: 11299 },
    "Gwen": { tier: "B-", metaWR: 49.34, metaGames: 6871 },
    "Volibear": { tier: "B-", metaWR: 49.93, metaGames: 6847 },
    "Warwick": { tier: "C", metaWR: 49.81, metaGames: 4278 },
    "Jax": { tier: "B-", metaWR: 49.53, metaGames: 14325 },
    "Shyvana": { tier: "C-", metaWR: 49.62, metaGames: 1969 },
    "Yone": { tier: "C+", metaWR: 48.54, metaGames: 12561 },
    "Irelia": { tier: "B-", metaWR: 49.60, metaGames: 9307 },
    "Cassiopeia": { tier: "C+", metaWR: 48.38, metaGames: 2598 },
    "Skarner": { tier: "D+", metaWR: 48.40, metaGames: 1097 },
    "Galio": { tier: "C", metaWR: 48.94, metaGames: 9201 },
    "LeBlanc": { tier: "C", metaWR: 49.35, metaGames: 9252 },
    "Ryze": { tier: "C-", metaWR: 47.23, metaGames: 10030 },
    "Aurora": { tier: "C-", metaWR: 49.30, metaGames: 7383 },
    "Yorick": { tier: "C", metaWR: 50.18, metaGames: 6911 },
    "Trundle": { tier: "C", metaWR: 48.37, metaGames: 2729 },
    "Mel": { tier: "D+", metaWR: 47.47, metaGames: 7367 },
    "Azir": { tier: "D", metaWR: 44.93, metaGames: 5090 },
    "ChoGath": { tier: "C-", metaWR: 49.43, metaGames: 5017 },
    "KSante": { tier: "C-", metaWR: 47.71, metaGames: 8784 },
    "Tryndamere": { tier: "D", metaWR: 48.17, metaGames: 4476 },
};

const TIER_COLOR = {
    "S+": "text-yellow-300", "S": "text-yellow-400", "S-": "text-yellow-500",
    "A+": "text-green-400", "A": "text-green-500", "A-": "text-green-600",
    "B+": "text-blue-300", "B": "text-blue-400", "B-": "text-blue-500",
    "C+": "text-slate-300", "C": "text-slate-400", "C-": "text-slate-500",
    "D+": "text-red-400", "D": "text-red-500", "D-": "text-red-600",
};

function normalizeChampName(name) {
    return name.replace(/['\u2019\s\.]/g, "");
}

export function ChampionMetaTab({ matches, seasonFetchDone, metaData }) {
    // Usa metaData prop (dati live da OP.GG) se disponibile, altrimenti fallback su META_DATA statico
    const activeMetaData = (metaData && Object.keys(metaData).length > 0) ? metaData : META_DATA;
    const [filterKey, setFilterKey] = useState("all");

    // Filtra i match in base al periodo selezionato
    const filteredMatches = useMemo(() => {
        if (!matches) return [];
        const opt = FILTER_OPTIONS.find(o => o.key === filterKey);
        if (!opt || opt.key === "all") return matches;
        return matches.filter(m => {
            const ts = m.gameCreation;
            if (!ts) return true; // se manca il timestamp, includi
            if (opt.to) return ts >= opt.from && ts <= opt.to;
            return ts >= opt.from;
        });
    }, [matches, filterKey]);

    if (!matches || matches.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 flex-col gap-3">
                <p className="text-slate-400">Nessun match caricato.</p>
                <p className="text-slate-600 text-xs">Vai su Match History e carica qualche partita.</p>
            </div>
        );
    }

    if (filteredMatches.length === 0) {
        return (
            <div className="flex flex-col gap-4">
                {/* Filtri visibili anche quando vuoto */}
                <div className="flex gap-2 flex-wrap">
                    {FILTER_OPTIONS.map(opt => (
                        <button
                            key={opt.key}
                            onClick={() => setFilterKey(opt.key)}
                            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${filterKey === opt.key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
                <div className="flex items-center justify-center h-48 flex-col gap-3">
                    <p className="text-slate-400">Nessuna partita nel periodo selezionato.</p>
                    <button
                        onClick={() => setFilterKey("all")}
                        className="text-blue-400 text-xs underline hover:text-blue-300"
                    >
                        Mostra tutte le partite
                    </button>
                </div>
            </div>
        );
    }

    const totalGames = filteredMatches.length;
    const totalWins = filteredMatches.filter(m => m.win).length;
    const globalWR = totalGames > 0 ? ((totalWins / totalGames) * 100).toFixed(1) : "0.0";
    const totalKills = filteredMatches.reduce((a, m) => a + (m.kills || 0), 0);
    const totalDeaths = filteredMatches.reduce((a, m) => a + (m.deaths || 0), 0);
    const totalAssists = filteredMatches.reduce((a, m) => a + (m.assists || 0), 0);
    const globalKDA = totalDeaths === 0 ? "Perfect" : ((totalKills + totalAssists) / totalDeaths).toFixed(2);
    const avgCs = totalGames > 0 ? (filteredMatches.reduce((a, m) => a + (m.totalMinionsKilled || 0), 0) / totalGames).toFixed(0) : 0;
    const avgGold = totalGames > 0 ? (filteredMatches.reduce((a, m) => a + (m.goldEarned || 0), 0) / totalGames).toFixed(0) : 0;

    const champStats = {};
    filteredMatches.forEach(m => {
        if (!m?.championName) return;
        const name = m.championName;
        if (!champStats[name]) {
            champStats[name] = { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, cs: 0, gold: 0 };
        }
        champStats[name].games += 1;
        champStats[name].wins += m.win ? 1 : 0;
        champStats[name].kills += m.kills || 0;
        champStats[name].deaths += m.deaths || 0;
        champStats[name].assists += m.assists || 0;
        champStats[name].cs += m.totalMinionsKilled || 0;
        champStats[name].gold += m.goldEarned || 0;
    });

    const champList = Object.entries(champStats)
        .map(([name, s]) => {
            const normalized = normalizeChampName(name);
            const meta = activeMetaData[normalized] || activeMetaData[name] || null;
            const myWR = parseFloat(((s.wins / s.games) * 100).toFixed(1));
            const diff = meta ? parseFloat((myWR - meta.metaWR).toFixed(1)) : null;
            return {
                name, games: s.games, wins: s.wins, losses: s.games - s.wins,
                winRate: myWR.toFixed(1),
                kda: s.deaths === 0 ? "Perfect" : ((s.kills + s.assists) / s.deaths).toFixed(2),
                avgKills: (s.kills / s.games).toFixed(1),
                avgDeaths: (s.deaths / s.games).toFixed(1),
                avgAssists: (s.assists / s.games).toFixed(1),
                avgCs: (s.cs / s.games).toFixed(0),
                avgGold: Math.round(s.gold / s.games).toLocaleString(),
                meta, myWR, diff,
            };
        })
        .sort((a, b) => b.games - a.games);

    const overPerformers = champList.filter(c => c.games >= 3 && c.diff !== null && c.diff >= 3);
    const underPerformers = champList.filter(c => c.games >= 3 && c.diff !== null && c.diff <= -3);

    const activeLabel = FILTER_OPTIONS.find(o => o.key === filterKey)?.label;

    return (
        <div className="space-y-6">

            {/* Banner caricamento season in corso */}
            {!seasonFetchDone && (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-950/60 border border-blue-800 rounded-lg text-sm text-blue-300">
                    <svg className="animate-spin w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    <span>Caricamento partite Season 2026 in corso… i dati si aggiornano automaticamente.</span>
                    <span className="ml-auto text-blue-500 text-xs">{matches?.length || 0} caricate</span>
                </div>
            )}

            {/* Header con dropdown filtro */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-bold text-white">Le tue statistiche</h2>
                <div className="flex items-center gap-3">
                    {/* Dropdown periodo */}
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5">
                        <Filter className="w-3.5 h-3.5 text-slate-400" />
                        <select
                            value={filterKey}
                            onChange={e => setFilterKey(e.target.value)}
                            className="bg-transparent text-slate-200 text-sm focus:outline-none cursor-pointer"
                        >
                            {FILTER_OPTIONS.map(o => (
                                <option key={o.key} value={o.key} className="bg-slate-800">
                                    {o.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <Badge className="bg-slate-700 text-slate-300 text-xs">
                        {totalGames} partite
                    </Badge>
                </div>
            </div>

            {/* Avviso se filtro azzera i match */}
            {totalGames === 0 && (
                <div className="p-4 bg-slate-800 border border-slate-700 rounded-lg text-center">
                    <p className="text-slate-400 text-sm">Nessuna partita trovata per <span className="text-white font-semibold">{activeLabel}</span>.</p>
                    <p className="text-slate-500 text-xs mt-1">Prova a caricare più partite o seleziona un periodo diverso.</p>
                </div>
            )}

            {totalGames > 0 && (<>

                {/* Statistiche globali */}
                <Card className="p-6 bg-slate-900 border-slate-700">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <Trophy className="w-5 h-5 text-yellow-400" />
                        Performance Generale
                        <span className="text-slate-500 text-xs font-normal ml-1">— {activeLabel}</span>
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-slate-800 rounded-lg p-4 text-center">
                            <p className={`text-2xl font-bold ${parseFloat(globalWR) >= 50 ? "text-green-400" : "text-red-400"}`}>{globalWR}%</p>
                            <p className="text-slate-400 text-xs mt-1">Win Rate</p>
                            <p className="text-slate-500 text-xs">{totalWins}V {totalGames - totalWins}S</p>
                        </div>
                        <div className="bg-slate-800 rounded-lg p-4 text-center">
                            <p className="text-2xl font-bold text-blue-400">{globalKDA}</p>
                            <p className="text-slate-400 text-xs mt-1">KDA Ratio</p>
                            <p className="text-slate-500 text-xs">{(totalKills / totalGames).toFixed(1)} / {(totalDeaths / totalGames).toFixed(1)} / {(totalAssists / totalGames).toFixed(1)}</p>
                        </div>
                        <div className="bg-slate-800 rounded-lg p-4 text-center">
                            <p className="text-2xl font-bold text-white">{avgCs}</p>
                            <p className="text-slate-400 text-xs mt-1">Avg CS</p>
                            <p className="text-slate-500 text-xs">per partita</p>
                        </div>
                        <div className="bg-slate-800 rounded-lg p-4 text-center">
                            <p className="text-2xl font-bold text-yellow-400">{parseInt(avgGold).toLocaleString()}</p>
                            <p className="text-slate-400 text-xs mt-1">Avg Gold</p>
                            <p className="text-slate-500 text-xs">per partita</p>
                        </div>
                    </div>
                </Card>

                {/* Over / Under Performance */}
                {(overPerformers.length > 0 || underPerformers.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {overPerformers.length > 0 && (
                            <Card className="p-4 bg-slate-900 border-green-800">
                                <div className="flex items-center gap-2 mb-3">
                                    <Zap className="w-4 h-4 text-green-400" />
                                    <h4 className="text-sm font-bold text-green-400">📊 Stai overperformando su:</h4>
                                    <span className="text-slate-500 text-xs ml-auto">vs meta WR</span>
                                </div>
                                <div className="space-y-2">
                                    {overPerformers.map(c => (
                                        <div key={c.name} className="flex items-center gap-3 bg-slate-800 rounded-lg px-3 py-2">
                                            <img src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${c.name}.png`} alt={c.name} className="w-8 h-8 rounded-md object-cover bg-slate-700" onError={e => { e.target.style.display = "none"; }} />
                                            <div className="flex-1">
                                                <p className="text-white text-sm font-semibold">{c.name}</p>
                                                <p className="text-slate-500 text-xs">{c.games} partite{c.meta && <> • Meta: <span className={TIER_COLOR[c.meta.tier] || "text-slate-300"}>{c.meta.tier}</span> {c.meta.metaWR}%</>}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-green-400 font-bold text-sm">{c.winRate}% WR</p>
                                                <p className="text-green-600 text-xs">+{c.diff}% vs meta</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}
                        {underPerformers.length > 0 && (
                            <Card className="p-4 bg-slate-900 border-red-900">
                                <div className="flex items-center gap-2 mb-3">
                                    <AlertTriangle className="w-4 h-4 text-red-400" />
                                    <h4 className="text-sm font-bold text-red-400">⚠️ Underperforming su meta picks:</h4>
                                    <span className="text-slate-500 text-xs ml-auto">vs meta WR</span>
                                </div>
                                <div className="space-y-2">
                                    {underPerformers.map(c => (
                                        <div key={c.name} className="flex items-center gap-3 bg-slate-800 rounded-lg px-3 py-2">
                                            <img src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${c.name}.png`} alt={c.name} className="w-8 h-8 rounded-md object-cover bg-slate-700" onError={e => { e.target.style.display = "none"; }} />
                                            <div className="flex-1">
                                                <p className="text-white text-sm font-semibold">{c.name}</p>
                                                <p className="text-slate-500 text-xs">{c.games} partite{c.meta && <> • Meta: <span className={TIER_COLOR[c.meta.tier] || "text-slate-300"}>{c.meta.tier}</span> {c.meta.metaWR}%</>}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-red-400 font-bold text-sm">{c.winRate}% WR</p>
                                                <p className="text-red-600 text-xs">{c.diff}% vs meta</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}
                    </div>
                )}

                {/* Champion breakdown */}
                <Card className="p-6 bg-slate-900 border-slate-700">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <Swords className="w-5 h-5 text-blue-400" />
                        Champion Breakdown
                    </h3>
                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 px-3 mb-2">
                        <p className="text-slate-500 text-xs">Campione</p>
                        <p className="text-slate-500 text-xs text-center">Partite</p>
                        <p className="text-slate-500 text-xs text-center">Win Rate</p>
                        <p className="text-slate-500 text-xs text-center">vs Meta</p>
                        <p className="text-slate-500 text-xs text-center">KDA</p>
                        <p className="text-slate-500 text-xs text-center">Avg CS</p>
                    </div>
                    <div className="space-y-2">
                        {champList.map((champ, i) => {
                            const wrNum = parseFloat(champ.winRate);
                            const kdaNum = champ.kda === "Perfect" ? 99 : parseFloat(champ.kda);
                            return (
                                <div key={champ.name} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 items-center bg-slate-800 rounded-lg px-3 py-2 hover:bg-slate-750 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <span className="text-slate-600 text-xs w-4">{i + 1}</span>
                                        <img src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${champ.name}.png`} alt={champ.name} className="w-9 h-9 rounded-md object-cover bg-slate-700" onError={e => { e.target.style.display = "none"; }} />
                                        <div>
                                            <div className="flex items-center gap-1">
                                                <p className="text-white text-sm font-semibold">{champ.name}</p>
                                                {champ.meta && <span className={`text-xs font-bold ${TIER_COLOR[champ.meta.tier] || "text-slate-400"}`}>{champ.meta.tier}</span>}
                                            </div>
                                            <p className="text-slate-500 text-xs">{champ.wins}V {champ.losses}S</p>
                                        </div>
                                    </div>
                                    <p className="text-slate-300 text-sm text-center">{champ.games}</p>
                                    <div className="text-center">
                                        <p className={`text-sm font-bold ${wrNum >= 60 ? "text-green-400" : wrNum >= 50 ? "text-green-300" : wrNum >= 40 ? "text-red-300" : "text-red-400"}`}>{champ.winRate}%</p>
                                        <div className="w-full bg-slate-700 rounded-full h-1 mt-1">
                                            <div className={`h-1 rounded-full ${wrNum >= 50 ? "bg-green-500" : "bg-red-500"}`} style={{ width: `${Math.min(wrNum, 100)}%` }} />
                                        </div>
                                    </div>
                                    <div className="text-center">
                                        {champ.meta ? (
                                            <>
                                                <p className={`text-xs font-bold ${champ.diff >= 3 ? "text-green-400" : champ.diff <= -3 ? "text-red-400" : "text-slate-400"}`}>{champ.diff > 0 ? "+" : ""}{champ.diff}%</p>
                                                <p className="text-slate-600 text-xs">{champ.meta.metaWR}% meta</p>
                                            </>
                                        ) : <p className="text-slate-600 text-xs">—</p>}
                                    </div>
                                    <p className={`text-sm font-bold text-center ${kdaNum >= 3 ? "text-blue-400" : kdaNum >= 2 ? "text-slate-300" : "text-slate-500"}`}>
                                        {champ.kda}
                                        <span className="block text-xs font-normal text-slate-500">{champ.avgKills}/{champ.avgDeaths}/{champ.avgAssists}</span>
                                    </p>
                                    <p className="text-slate-300 text-sm text-center">{champ.avgCs}</p>
                                </div>
                            );
                        })}
                    </div>
                </Card>

                {/* Top performer cards */}
                {champList.length >= 2 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(() => {
                            const best = [...champList].filter(c => c.games >= 2).sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate))[0];
                            if (!best) return null;
                            return (
                                <Card className="p-4 bg-slate-900 border-green-900">
                                    <div className="flex items-center gap-2 mb-3">
                                        <TrendingUp className="w-4 h-4 text-green-400" />
                                        <h4 className="text-sm font-bold text-green-400">Miglior Win Rate</h4>
                                        <span className="text-slate-500 text-xs ml-auto">min. 2 partite</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <img src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${best.name}.png`} alt={best.name} className="w-12 h-12 rounded-lg object-cover" onError={e => { e.target.style.display = "none"; }} />
                                        <div>
                                            <p className="text-white font-bold">{best.name}</p>
                                            <p className="text-green-400 text-lg font-bold">{best.winRate}% WR</p>
                                            <p className="text-slate-400 text-xs">{best.games} partite • {best.kda} KDA</p>
                                        </div>
                                    </div>
                                </Card>
                            );
                        })()}
                        {(() => {
                            const best = [...champList].filter(c => c.games >= 2 && c.kda !== "Perfect").sort((a, b) => parseFloat(b.kda) - parseFloat(a.kda))[0];
                            if (!best) return null;
                            return (
                                <Card className="p-4 bg-slate-900 border-blue-900">
                                    <div className="flex items-center gap-2 mb-3">
                                        <Target className="w-4 h-4 text-blue-400" />
                                        <h4 className="text-sm font-bold text-blue-400">Miglior KDA</h4>
                                        <span className="text-slate-500 text-xs ml-auto">min. 2 partite</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <img src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${best.name}.png`} alt={best.name} className="w-12 h-12 rounded-lg object-cover" onError={e => { e.target.style.display = "none"; }} />
                                        <div>
                                            <p className="text-white font-bold">{best.name}</p>
                                            <p className="text-blue-400 text-lg font-bold">{best.kda} KDA</p>
                                            <p className="text-slate-400 text-xs">{best.games} partite • {best.winRate}% WR</p>
                                        </div>
                                    </div>
                                </Card>
                            );
                        })()}
                    </div>
                )}

                <p className="text-center text-slate-600 text-xs pb-4">
                    Meta data: {metaData && Object.keys(metaData).length > 0 ? "OP.GG Live" : "Lolalytics (statico)"} Emerald+ ({Object.keys(activeMetaData).length} campioni) • {activeLabel} • {totalGames} partite
                </p>

            </>)}
        </div>
    );
}