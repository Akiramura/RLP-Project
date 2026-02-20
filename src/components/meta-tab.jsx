import { useState, useMemo } from "react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Search } from "lucide-react";

const PATCH = "14.24.1";

const META_CHAMPIONS = [
  { name: "Ahri",         tier: "S+", metaWR: 52.40, pick: 14.47, ban: 6.79,  games: 31360, lane: "mid"     },
  { name: "Jinx",         tier: "S+", metaWR: 51.96, pick: 15.96, ban: 5.67,  games: 34588, lane: "adc"     },
  { name: "Nami",         tier: "S+", metaWR: 52.12, pick: 14.04, ban: 3.83,  games: 30426, lane: "support" },
  { name: "RekSai",       tier: "S+", metaWR: 53.04, pick: 2.64,  ban: 2.90,  games: 5726,  lane: "jungle"  },
  { name: "Singed",       tier: "S+", metaWR: 53.96, pick: 2.95,  ban: 1.25,  games: 6392,  lane: "top"     },
  { name: "Sona",         tier: "S+", metaWR: 52.61, pick: 4.84,  ban: 1.17,  games: 10483, lane: "support" },
  { name: "KhaZix",       tier: "S+", metaWR: 51.28, pick: 11.58, ban: 17.84, games: 25102, lane: "jungle"  },
  { name: "Akshan",       tier: "S+", metaWR: 52.72, pick: 2.86,  ban: 3.35,  games: 6202,  lane: "mid"     },
  { name: "Ekko",         tier: "S",  metaWR: 52.58, pick: 4.77,  ban: 5.87,  games: 10330, lane: "jungle"  },
  { name: "Thresh",       tier: "S",  metaWR: 51.76, pick: 13.88, ban: 6.90,  games: 30089, lane: "support" },
  { name: "Bard",         tier: "S",  metaWR: 51.21, pick: 6.84,  ban: 2.99,  games: 14820, lane: "support" },
  { name: "Kayle",        tier: "S",  metaWR: 53.28, pick: 3.74,  ban: 5.76,  games: 8104,  lane: "top"     },
  { name: "Elise",        tier: "S",  metaWR: 52.08, pick: 2.48,  ban: 2.00,  games: 5380,  lane: "jungle"  },
  { name: "Katarina",     tier: "S",  metaWR: 51.25, pick: 7.00,  ban: 9.92,  games: 15170, lane: "mid"     },
  { name: "Zaahen",       tier: "S",  metaWR: 50.49, pick: 5.87,  ban: 11.40, games: 12729, lane: "top"     },
  { name: "Jhin",         tier: "S-", metaWR: 50.62, pick: 14.70, ban: 1.25,  games: 31857, lane: "adc"     },
  { name: "Gangplank",    tier: "S-", metaWR: 51.27, pick: 5.08,  ban: 5.41,  games: 11016, lane: "top"     },
  { name: "Braum",        tier: "S-", metaWR: 51.25, pick: 7.84,  ban: 20.75, games: 16997, lane: "support" },
  { name: "Ornn",         tier: "S-", metaWR: 52.76, pick: 5.40,  ban: 1.04,  games: 11706, lane: "top"     },
  { name: "Shen",         tier: "S-", metaWR: 52.59, pick: 3.73,  ban: 0.69,  games: 8087,  lane: "top"     },
  { name: "Zoe",          tier: "S-", metaWR: 51.13, pick: 3.61,  ban: 6.67,  games: 7816,  lane: "mid"     },
  { name: "Aatrox",       tier: "S-", metaWR: 50.24, pick: 7.35,  ban: 8.55,  games: 15926, lane: "top"     },
  { name: "LeeSin",       tier: "S-", metaWR: 50.23, pick: 11.67, ban: 13.39, games: 25296, lane: "jungle"  },
  { name: "Xayah",        tier: "A+", metaWR: 52.06, pick: 6.12,  ban: 0.81,  games: 13255, lane: "adc"     },
  { name: "Neeko",        tier: "A+", metaWR: 50.82, pick: 3.22,  ban: 2.99,  games: 6985,  lane: "support" },
  { name: "Leona",        tier: "A+", metaWR: 51.67, pick: 7.65,  ban: 6.47,  games: 16587, lane: "support" },
  { name: "Ivern",        tier: "A+", metaWR: 53.09, pick: 1.10,  ban: 0.51,  games: 2392,  lane: "jungle"  },
  { name: "XinZhao",      tier: "A+", metaWR: 51.51, pick: 7.00,  ban: 4.79,  games: 15165, lane: "jungle"  },
  { name: "Zilean",       tier: "A+", metaWR: 52.23, pick: 2.89,  ban: 1.34,  games: 6255,  lane: "support" },
  { name: "Olaf",         tier: "A+", metaWR: 52.02, pick: 2.22,  ban: 1.69,  games: 4821,  lane: "top"     },
  { name: "KogMaw",       tier: "A-", metaWR: 53.79, pick: 2.07,  ban: 0.60,  games: 4493,  lane: "adc"     },
  { name: "Xerath",       tier: "A+", metaWR: 52.43, pick: 4.79,  ban: 5.75,  games: 10371, lane: "mid"     },
  { name: "Graves",       tier: "A+", metaWR: 51.54, pick: 8.68,  ban: 5.39,  games: 18803, lane: "jungle"  },
  { name: "Milio",        tier: "A+", metaWR: 51.49, pick: 6.75,  ban: 5.99,  games: 14619, lane: "support" },
  { name: "Rakan",        tier: "A+", metaWR: 51.43, pick: 4.28,  ban: 0.34,  games: 9282,  lane: "support" },
  { name: "TwistedFate",  tier: "A+", metaWR: 51.87, pick: 5.50,  ban: 1.49,  games: 11916, lane: "mid"     },
  { name: "AurelionSol",  tier: "A+", metaWR: 52.39, pick: 2.90,  ban: 0.88,  games: 6282,  lane: "mid"     },
  { name: "Smolder",      tier: "A",  metaWR: 51.30, pick: 8.61,  ban: 5.20,  games: 18662, lane: "adc"     },
  { name: "Nunu",         tier: "A",  metaWR: 52.50, pick: 2.32,  ban: 1.00,  games: 5036,  lane: "jungle"  },
  { name: "Nautilus",     tier: "A",  metaWR: 50.21, pick: 10.72, ban: 13.15, games: 23231, lane: "support" },
  { name: "Diana",        tier: "A",  metaWR: 50.46, pick: 5.03,  ban: 10.64, games: 10897, lane: "jungle"  },
  { name: "Rell",         tier: "A",  metaWR: 50.33, pick: 2.76,  ban: 0.77,  games: 5973,  lane: "support" },
  { name: "MasterYi",     tier: "A",  metaWR: 50.62, pick: 4.67,  ban: 10.40, games: 10126, lane: "jungle"  },
  { name: "Soraka",       tier: "A",  metaWR: 51.79, pick: 4.58,  ban: 2.37,  games: 9935,  lane: "support" },
  { name: "Anivia",       tier: "A",  metaWR: 52.16, pick: 3.25,  ban: 2.61,  games: 7044,  lane: "mid"     },
  { name: "Seraphine",    tier: "A",  metaWR: 51.36, pick: 3.97,  ban: 0.67,  games: 8609,  lane: "support" },
  { name: "BelVeth",      tier: "A",  metaWR: 50.93, pick: 1.62,  ban: 2.69,  games: 3507,  lane: "jungle"  },
  { name: "Shaco",        tier: "A",  metaWR: 51.70, pick: 4.06,  ban: 18.76, games: 8798,  lane: "jungle"  },
  { name: "Viktor",       tier: "A",  metaWR: 51.10, pick: 6.55,  ban: 3.20,  games: 14207, lane: "mid"     },
  { name: "Ambessa",      tier: "A",  metaWR: 50.04, pick: 4.68,  ban: 11.12, games: 10146, lane: "top"     },
  { name: "Blitzcrank",   tier: "A",  metaWR: 50.93, pick: 5.56,  ban: 13.34, games: 12053, lane: "support" },
  { name: "Kennen",       tier: "A",  metaWR: 50.21, pick: 2.80,  ban: 3.44,  games: 6065,  lane: "top"     },
  { name: "Malzahar",     tier: "A",  metaWR: 51.49, pick: 5.97,  ban: 8.48,  games: 12942, lane: "mid"     },
  { name: "Urgot",        tier: "A",  metaWR: 52.54, pick: 2.59,  ban: 0.93,  games: 5607,  lane: "top"     },
  { name: "Veigar",       tier: "A",  metaWR: 51.52, pick: 4.04,  ban: 1.59,  games: 8757,  lane: "mid"     },
  { name: "Quinn",        tier: "A",  metaWR: 52.61, pick: 0.89,  ban: 0.80,  games: 1933,  lane: "top"     },
  { name: "MissFortune",  tier: "A",  metaWR: 51.47, pick: 8.27,  ban: 2.60,  games: 17922, lane: "adc"     },
  { name: "Janna",        tier: "A-", metaWR: 51.60, pick: 3.83,  ban: 0.97,  games: 8303,  lane: "support" },
  { name: "Briar",        tier: "A-", metaWR: 52.11, pick: 4.70,  ban: 8.85,  games: 10182, lane: "jungle"  },
  { name: "Lux",          tier: "A-", metaWR: 50.35, pick: 5.17,  ban: 3.11,  games: 11212, lane: "support" },
  { name: "Karma",        tier: "A-", metaWR: 50.08, pick: 9.72,  ban: 5.56,  games: 21063, lane: "support" },
  { name: "Kindred",      tier: "A-", metaWR: 51.24, pick: 2.04,  ban: 1.71,  games: 4420,  lane: "jungle"  },
  { name: "Pyke",         tier: "A-", metaWR: 50.30, pick: 5.53,  ban: 23.85, games: 11989, lane: "support" },
  { name: "Vladimir",     tier: "A-", metaWR: 50.70, pick: 2.73,  ban: 4.50,  games: 5927,  lane: "mid"     },
  { name: "Fiddlesticks",  tier: "A-", metaWR: 52.61, pick: 2.65, ban: 1.98,  games: 5752,  lane: "jungle"  },
  { name: "Zyra",         tier: "A-", metaWR: 51.00, pick: 2.63,  ban: 2.81,  games: 5704,  lane: "support" },
  { name: "Maokai",       tier: "A-", metaWR: 52.59, pick: 2.55,  ban: 0.31,  games: 5526,  lane: "support" },
  { name: "Zed",          tier: "A-", metaWR: 50.03, pick: 6.66,  ban: 26.85, games: 14431, lane: "mid"     },
  { name: "Naafiri",      tier: "A-", metaWR: 50.20, pick: 3.93,  ban: 14.68, games: 8524,  lane: "jungle"  },
  { name: "Alistar",      tier: "A-", metaWR: 49.94, pick: 4.75,  ban: 1.70,  games: 10292, lane: "support" },
  { name: "Fizz",         tier: "A-", metaWR: 51.57, pick: 3.94,  ban: 5.64,  games: 8529,  lane: "mid"     },
  { name: "DrMundo",      tier: "A-", metaWR: 50.26, pick: 3.96,  ban: 8.85,  games: 8582,  lane: "top"     },
  { name: "Akali",        tier: "A-", metaWR: 50.01, pick: 6.74,  ban: 24.74, games: 14618, lane: "mid"     },
  { name: "Kled",         tier: "A-", metaWR: 51.55, pick: 1.77,  ban: 0.74,  games: 3827,  lane: "top"     },
  { name: "Sett",         tier: "A-", metaWR: 51.09, pick: 5.34,  ban: 2.26,  games: 11574, lane: "top"     },
  { name: "Riven",        tier: "A-", metaWR: 50.14, pick: 3.78,  ban: 3.29,  games: 8187,  lane: "top"     },
  { name: "Heimerdinger",  tier: "A-", metaWR: 53.51, pick: 0.93, ban: 1.20,  games: 2020,  lane: "top"     },
  { name: "Darius",       tier: "A-", metaWR: 50.42, pick: 5.82,  ban: 13.36, games: 12621, lane: "top"     },
  { name: "Vayne",        tier: "B+", metaWR: 50.79, pick: 5.81,  ban: 8.05,  games: 12603, lane: "adc"     },
  { name: "Twitch",       tier: "B+", metaWR: 50.51, pick: 6.26,  ban: 8.18,  games: 13576, lane: "adc"     },
  { name: "KaiSa",        tier: "B+", metaWR: 50.03, pick: 19.00, ban: 2.93,  games: 41178, lane: "adc"     },
  { name: "Caitlyn",      tier: "B+", metaWR: 50.63, pick: 16.92, ban: 27.37, games: 36667, lane: "adc"     },
  { name: "Brand",        tier: "B+", metaWR: 51.35, pick: 2.61,  ban: 2.67,  games: 5649,  lane: "support" },
  { name: "Talon",        tier: "B+", metaWR: 49.94, pick: 3.52,  ban: 5.47,  games: 7637,  lane: "jungle"  },
  { name: "Evelynn",      tier: "B+", metaWR: 51.86, pick: 2.26,  ban: 2.63,  games: 4909,  lane: "jungle"  },
  { name: "Annie",        tier: "B+", metaWR: 52.75, pick: 1.98,  ban: 0.48,  games: 4296,  lane: "mid"     },
  { name: "Rammus",       tier: "B+", metaWR: 51.56, pick: 1.58,  ban: 3.14,  games: 3431,  lane: "jungle"  },
  { name: "VelKoz",       tier: "B+", metaWR: 51.02, pick: 2.55,  ban: 0.98,  games: 5535,  lane: "support" },
  { name: "Vex",          tier: "B+", metaWR: 52.78, pick: 2.97,  ban: 3.56,  games: 6429,  lane: "mid"     },
  { name: "Qiyana",       tier: "B+", metaWR: 49.14, pick: 2.61,  ban: 4.55,  games: 5667,  lane: "mid"     },
  { name: "Camille",      tier: "B+", metaWR: 50.90, pick: 2.73,  ban: 0.84,  games: 5919,  lane: "top"     },
  { name: "Taliyah",      tier: "B+", metaWR: 50.02, pick: 2.11,  ban: 0.62,  games: 4570,  lane: "mid"     },
  { name: "Renekton",     tier: "B+", metaWR: 50.23, pick: 5.85,  ban: 4.70,  games: 12683, lane: "top"     },
  { name: "Gnar",         tier: "B+", metaWR: 51.24, pick: 4.05,  ban: 1.40,  games: 8775,  lane: "top"     },
  { name: "Mordekaiser",  tier: "B+", metaWR: 51.14, pick: 5.32,  ban: 6.61,  games: 11526, lane: "top"     },
  { name: "Nasus",        tier: "B+", metaWR: 51.38, pick: 3.75,  ban: 3.99,  games: 8124,  lane: "top"     },
  { name: "Garen",        tier: "B+", metaWR: 50.75, pick: 5.11,  ban: 3.08,  games: 11080, lane: "top"     },
  { name: "Nilah",        tier: "B",  metaWR: 52.69, pick: 1.61,  ban: 3.28,  games: 3496,  lane: "adc"     },
  { name: "Samira",       tier: "B",  metaWR: 50.93, pick: 6.45,  ban: 6.54,  games: 13979, lane: "adc"     },
  { name: "Ashe",         tier: "B",  metaWR: 50.99, pick: 6.21,  ban: 1.36,  games: 13451, lane: "adc"     },
  { name: "Aphelios",     tier: "B",  metaWR: 47.45, pick: 8.51,  ban: 9.89,  games: 18446, lane: "adc"     },
  { name: "Zac",          tier: "B",  metaWR: 49.70, pick: 3.36,  ban: 2.05,  games: 7277,  lane: "jungle"  },
  { name: "JarvanIV",     tier: "B",  metaWR: 49.85, pick: 5.93,  ban: 1.46,  games: 12856, lane: "jungle"  },
  { name: "Lillia",       tier: "B",  metaWR: 51.00, pick: 2.80,  ban: 1.48,  games: 6078,  lane: "jungle"  },
  { name: "Taric",        tier: "B",  metaWR: 50.36, pick: 1.23,  ban: 0.21,  games: 2661,  lane: "support" },
  { name: "Poppy",        tier: "B",  metaWR: 50.30, pick: 1.77,  ban: 3.62,  games: 3843,  lane: "support" },
  { name: "Hecarim",      tier: "B",  metaWR: 49.47, pick: 3.72,  ban: 2.96,  games: 8063,  lane: "jungle"  },
  { name: "Rengar",       tier: "B",  metaWR: 49.22, pick: 3.71,  ban: 9.04,  games: 8038,  lane: "jungle"  },
  { name: "Lulu",         tier: "B",  metaWR: 49.59, pick: 10.45, ban: 10.20, games: 22641, lane: "support" },
  { name: "Swain",        tier: "B",  metaWR: 47.92, pick: 2.81,  ban: 5.99,  games: 6098,  lane: "support" },
  { name: "Sylas",        tier: "B",  metaWR: 49.02, pick: 6.99,  ban: 13.13, games: 15154, lane: "mid"     },
  { name: "Kassadin",     tier: "B",  metaWR: 49.37, pick: 4.49,  ban: 7.25,  games: 9729,  lane: "mid"     },
  { name: "Jayce",        tier: "B",  metaWR: 49.91, pick: 3.56,  ban: 5.56,  games: 7720,  lane: "top"     },
  { name: "Yasuo",        tier: "B",  metaWR: 49.76, pick: 8.80,  ban: 18.48, games: 19064, lane: "mid"     },
  { name: "Malphite",     tier: "B",  metaWR: 50.99, pick: 5.99,  ban: 26.60, games: 12973, lane: "top"     },
  { name: "Illaoi",       tier: "B",  metaWR: 50.91, pick: 2.29,  ban: 3.08,  games: 4954,  lane: "top"     },
  { name: "Sion",         tier: "B",  metaWR: 50.61, pick: 4.73,  ban: 1.10,  games: 10256, lane: "top"     },
  { name: "Gragas",       tier: "B",  metaWR: 50.14, pick: 2.01,  ban: 0.68,  games: 4362,  lane: "top"     },
  { name: "Teemo",        tier: "B",  metaWR: 51.23, pick: 2.40,  ban: 4.22,  games: 5198,  lane: "top"     },
  { name: "Rumble",       tier: "B",  metaWR: 48.99, pick: 3.03,  ban: 3.09,  games: 6575,  lane: "top"     },
  { name: "Sivir",        tier: "B-", metaWR: 50.83, pick: 6.74,  ban: 5.83,  games: 14615, lane: "adc"     },
  { name: "Draven",       tier: "B-", metaWR: 49.67, pick: 3.51,  ban: 12.91, games: 7614,  lane: "adc"     },
  { name: "Kayn",         tier: "B-", metaWR: 49.76, pick: 4.67,  ban: 2.85,  games: 10128, lane: "jungle"  },
  { name: "Vi",           tier: "B-", metaWR: 50.52, pick: 6.31,  ban: 2.77,  games: 13666, lane: "jungle"  },
  { name: "Wukong",       tier: "B-", metaWR: 51.65, pick: 2.57,  ban: 0.63,  games: 5574,  lane: "jungle"  },
  { name: "Karthus",      tier: "B-", metaWR: 49.43, pick: 1.49,  ban: 1.88,  games: 3219,  lane: "jungle"  },
  { name: "Morgana",      tier: "B-", metaWR: 50.18, pick: 4.30,  ban: 15.73, games: 9330,  lane: "support" },
  { name: "Nidalee",      tier: "B-", metaWR: 49.96, pick: 2.07,  ban: 1.14,  games: 4484,  lane: "jungle"  },
  { name: "Amumu",        tier: "B-", metaWR: 50.93, pick: 2.12,  ban: 1.22,  games: 4585,  lane: "jungle"  },
  { name: "Senna",        tier: "B-", metaWR: 49.84, pick: 5.94,  ban: 0.88,  games: 12868, lane: "support" },
  { name: "Hwei",         tier: "B-", metaWR: 50.50, pick: 3.62,  ban: 1.83,  games: 7847,  lane: "mid"     },
  { name: "Orianna",      tier: "B-", metaWR: 48.00, pick: 5.15,  ban: 1.52,  games: 11169, lane: "mid"     },
  { name: "Lissandra",    tier: "B-", metaWR: 50.53, pick: 3.07,  ban: 1.41,  games: 6662,  lane: "mid"     },
  { name: "Syndra",       tier: "B-", metaWR: 49.85, pick: 5.21,  ban: 3.95,  games: 11299, lane: "mid"     },
  { name: "Gwen",         tier: "B-", metaWR: 49.34, pick: 3.17,  ban: 10.37, games: 6871,  lane: "top"     },
  { name: "Volibear",     tier: "B-", metaWR: 49.93, pick: 3.16,  ban: 4.95,  games: 6847,  lane: "top"     },
  { name: "Jax",          tier: "B-", metaWR: 49.53, pick: 6.61,  ban: 14.91, games: 14325, lane: "top"     },
  { name: "Irelia",       tier: "B-", metaWR: 49.60, pick: 4.29,  ban: 13.98, games: 9307,  lane: "top"     },
  { name: "Fiora",        tier: "B",  metaWR: 49.67, pick: 3.69,  ban: 5.89,  games: 7999,  lane: "top"     },
  { name: "Lucian",       tier: "C",  metaWR: 49.56, pick: 8.82,  ban: 3.36,  games: 19106, lane: "adc"     },
  { name: "Tristana",     tier: "C+", metaWR: 50.28, pick: 3.77,  ban: 1.14,  games: 8169,  lane: "adc"     },
  { name: "Yunara",       tier: "C+", metaWR: 48.23, pick: 9.27,  ban: 3.57,  games: 20097, lane: "adc"     },
  { name: "Viego",        tier: "C+", metaWR: 49.37, pick: 12.60, ban: 15.27, games: 27299, lane: "jungle"  },
  { name: "Nocturne",     tier: "C+", metaWR: 50.10, pick: 3.56,  ban: 3.94,  games: 7709,  lane: "jungle"  },
  { name: "TahmKench",    tier: "C+", metaWR: 49.76, pick: 2.00,  ban: 1.65,  games: 4327,  lane: "support" },
  { name: "Sejuani",      tier: "C+", metaWR: 51.07, pick: 1.83,  ban: 0.19,  games: 3977,  lane: "jungle"  },
  { name: "Pantheon",     tier: "C+", metaWR: 48.86, pick: 2.82,  ban: 1.43,  games: 6103,  lane: "support" },
  { name: "Yuumi",        tier: "C+", metaWR: 47.64, pick: 4.68,  ban: 6.71,  games: 10148, lane: "support" },
  { name: "Zeri",         tier: "C+", metaWR: 49.51, pick: 2.08,  ban: 0.20,  games: 4516,  lane: "adc"     },
  { name: "Cassiopeia",   tier: "C+", metaWR: 48.38, pick: 1.20,  ban: 1.16,  games: 2598,  lane: "mid"     },
  { name: "Yone",         tier: "C+", metaWR: 48.54, pick: 5.80,  ban: 4.66,  games: 12561, lane: "mid"     },
  { name: "Galio",        tier: "C",  metaWR: 48.94, pick: 4.25,  ban: 1.94,  games: 9201,  lane: "mid"     },
  { name: "LeBlanc",      tier: "C",  metaWR: 49.35, pick: 4.27,  ban: 17.64, games: 9252,  lane: "mid"     },
  { name: "Ezreal",       tier: "C",  metaWR: 49.21, pick: 18.79, ban: 6.00,  games: 40718, lane: "adc"     },
  { name: "Ziggs",        tier: "C",  metaWR: 51.91, pick: 1.57,  ban: 0.50,  games: 3406,  lane: "adc"     },
  { name: "Corki",        tier: "C-", metaWR: 49.33, pick: 3.57,  ban: 0.70,  games: 7742,  lane: "adc"     },
  { name: "Warwick",      tier: "C",  metaWR: 49.81, pick: 1.97,  ban: 1.23,  games: 4278,  lane: "jungle"  },
  { name: "Udyr",         tier: "C",  metaWR: 49.42, pick: 1.84,  ban: 1.10,  games: 3978,  lane: "jungle"  },
  { name: "RenataGlasc",  tier: "C",  metaWR: 49.33, pick: 1.00,  ban: 0.14,  games: 2173,  lane: "support" },
  { name: "Yorick",       tier: "C",  metaWR: 50.18, pick: 3.19,  ban: 5.77,  games: 6911,  lane: "top"     },
  { name: "Trundle",      tier: "C",  metaWR: 48.37, pick: 1.26,  ban: 0.46,  games: 2729,  lane: "top"     },
  { name: "ChoGath",      tier: "C-", metaWR: 49.43, pick: 2.31,  ban: 0.69,  games: 5017,  lane: "top"     },
  { name: "Aurora",       tier: "C-", metaWR: 49.30, pick: 3.41,  ban: 1.97,  games: 7383,  lane: "mid"     },
  { name: "Ryze",         tier: "C-", metaWR: 47.23, pick: 4.63,  ban: 2.10,  games: 10030, lane: "mid"     },
  { name: "Shyvana",      tier: "C-", metaWR: 49.62, pick: 0.91,  ban: 0.11,  games: 1969,  lane: "jungle"  },
  { name: "KSante",       tier: "C-", metaWR: 47.71, pick: 4.05,  ban: 2.41,  games: 8784,  lane: "top"     },
  { name: "Varus",        tier: "D+", metaWR: 48.79, pick: 5.26,  ban: 14.74, games: 11393, lane: "adc"     },
  { name: "Skarner",      tier: "D+", metaWR: 48.40, pick: 0.51,  ban: 0.11,  games: 1097,  lane: "jungle"  },
  { name: "Mel",          tier: "D+", metaWR: 47.47, pick: 3.40,  ban: 17.73, games: 7367,  lane: "mid"     },
  { name: "Kalista",      tier: "D-", metaWR: 48.12, pick: 0.87,  ban: 0.16,  games: 1893,  lane: "adc"     },
  { name: "Azir",         tier: "D",  metaWR: 44.93, pick: 2.35,  ban: 0.38,  games: 5090,  lane: "mid"     },
  { name: "Tryndamere",   tier: "D",  metaWR: 48.17, pick: 2.07,  ban: 1.48,  games: 4476,  lane: "top"     },
];

const TIER_ORDER = ["S+","S","S-","A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-"];

const TIER_STYLE = {
  "S+": { bg: "bg-yellow-500/20", border: "border-yellow-500/40", text: "text-yellow-300", badge: "bg-yellow-500/30 text-yellow-200" },
  "S":  { bg: "bg-yellow-500/15", border: "border-yellow-500/30", text: "text-yellow-400", badge: "bg-yellow-500/25 text-yellow-300" },
  "S-": { bg: "bg-yellow-500/10", border: "border-yellow-500/20", text: "text-yellow-500", badge: "bg-yellow-500/20 text-yellow-400" },
  "A+": { bg: "bg-green-500/15",  border: "border-green-500/30",  text: "text-green-400",  badge: "bg-green-500/25 text-green-300"  },
  "A":  { bg: "bg-green-500/10",  border: "border-green-500/20",  text: "text-green-500",  badge: "bg-green-500/20 text-green-400"  },
  "A-": { bg: "bg-green-500/8",   border: "border-green-500/15",  text: "text-green-600",  badge: "bg-green-500/15 text-green-500"  },
  "B+": { bg: "bg-blue-500/15",   border: "border-blue-500/30",   text: "text-blue-300",   badge: "bg-blue-500/25 text-blue-200"   },
  "B":  { bg: "bg-blue-500/10",   border: "border-blue-500/20",   text: "text-blue-400",   badge: "bg-blue-500/20 text-blue-300"   },
  "B-": { bg: "bg-blue-500/8",    border: "border-blue-500/15",   text: "text-blue-500",   badge: "bg-blue-500/15 text-blue-400"   },
  "C+": { bg: "bg-slate-500/15",  border: "border-slate-500/30",  text: "text-slate-300",  badge: "bg-slate-500/25 text-slate-200" },
  "C":  { bg: "bg-slate-500/10",  border: "border-slate-500/20",  text: "text-slate-400",  badge: "bg-slate-500/20 text-slate-300" },
  "C-": { bg: "bg-slate-500/8",   border: "border-slate-500/15",  text: "text-slate-500",  badge: "bg-slate-500/15 text-slate-400" },
  "D+": { bg: "bg-red-500/15",    border: "border-red-500/30",    text: "text-red-400",    badge: "bg-red-500/25 text-red-300"    },
  "D":  { bg: "bg-red-500/10",    border: "border-red-500/20",    text: "text-red-500",    badge: "bg-red-500/20 text-red-400"    },
  "D-": { bg: "bg-red-500/8",     border: "border-red-500/15",    text: "text-red-600",    badge: "bg-red-500/15 text-red-500"    },
};

const LANES = [
  { key: "all",     label: "All",     icon: "⚔️" },
  { key: "top",     label: "Top",     icon: "🛡️" },
  { key: "jungle",  label: "Jungle",  icon: "🌲" },
  { key: "mid",     label: "Mid",     icon: "✨" },
  { key: "adc",     label: "ADC",     icon: "🏹" },
  { key: "support", label: "Support", icon: "💊" },
];

export function MetaTab() {
  const [lane, setLane] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return META_CHAMPIONS.filter(c => {
      const matchLane = lane === "all" || c.lane === lane;
      const matchSearch = c.name.toLowerCase().includes(search.toLowerCase());
      return matchLane && matchSearch;
    });
  }, [lane, search]);

  // Raggruppa per tier
  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(c => {
      if (!map[c.tier]) map[c.tier] = [];
      map[c.tier].push(c);
    });
    return TIER_ORDER.filter(t => map[t]?.length > 0).map(t => ({ tier: t, champs: map[t] }));
  }, [filtered]);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Champion Tier List</h2>
          <p className="text-slate-400 text-xs mt-0.5">Lolalytics • Emerald+ • Patch {PATCH} • {META_CHAMPIONS.length} campioni</p>
        </div>
        <Badge className="bg-slate-800 text-slate-300 border border-slate-700 text-xs">
          {filtered.length} campioni
        </Badge>
      </div>

      {/* Filtri */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Lane filter */}
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 flex-wrap">
          {LANES.map(l => (
            <button
              key={l.key}
              onClick={() => setLane(l.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                lane === l.key
                  ? "bg-blue-600 text-white shadow"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <span>{l.icon}</span>
              {l.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Cerca campione..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-600"
          />
        </div>
      </div>

      {/* Tier list */}
      <div className="space-y-3">
        {grouped.length === 0 && (
          <div className="text-center py-16 text-slate-500">Nessun campione trovato.</div>
        )}
        {grouped.map(({ tier, champs }) => {
          const style = TIER_STYLE[tier] || TIER_STYLE["C"];
          return (
            <div key={tier} className={`rounded-xl border ${style.border} overflow-hidden`}>
              {/* Tier header */}
              <div className={`${style.bg} px-4 py-2 flex items-center gap-3`}>
                <span className={`text-2xl font-black w-10 text-center ${style.text}`}>{tier}</span>
                <div className="h-px flex-1 bg-white/5" />
                <span className="text-slate-500 text-xs">{champs.length} campioni</span>
              </div>

              {/* Champions grid */}
              <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 bg-slate-900/60">
                {champs.map(c => (
                  <div
                    key={c.name}
                    className="flex flex-col items-center gap-1.5 bg-slate-800/60 hover:bg-slate-800 rounded-lg p-2 cursor-pointer transition-all group border border-transparent hover:border-slate-700"
                  >
                    <div className="relative">
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/champion/${c.name}.png`}
                        alt={c.name}
                        className="w-12 h-12 rounded-lg object-cover bg-slate-700 group-hover:scale-105 transition-transform"
                        onError={e => { e.target.src = ""; e.target.style.display = "none"; }}
                      />
                      {/* Lane icon overlay */}
                      <span className="absolute -bottom-1 -right-1 text-xs bg-slate-900 rounded px-0.5 border border-slate-700">
                        {LANES.find(l => l.key === c.lane)?.icon}
                      </span>
                    </div>
                    <p className="text-white text-xs font-semibold text-center leading-tight">{c.name}</p>
                    <div className="flex flex-col items-center gap-0.5 w-full">
                      <span className={`text-xs font-bold ${parseFloat(c.metaWR) >= 52 ? "text-green-400" : parseFloat(c.metaWR) >= 50 ? "text-slate-300" : "text-red-400"}`}>
                        {c.metaWR}% WR
                      </span>
                      <div className="flex gap-1 text-slate-500 text-xs">
                        <span title="Pick rate">P:{c.pick}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-slate-600 text-xs pb-4">
        Dati: Lolalytics Emerald+ • Patch {PATCH}
      </p>
    </div>
  );
}
