// champ_select.rs — complete rewrite
use reqwest::Client;
use serde_json::{json, Value};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use base64::{engine::general_purpose, Engine as _};

const PATCH: &str = "16.4.1";

fn spell_name_to_id(name: &str) -> Option<u32> {
    match name.to_lowercase().as_str() {
        "flash"|"summonerflash"     => Some(4),
        "ignite"|"summonerdot"      => Some(14),
        "teleport"|"summonerteleport" => Some(12),
        "barrier"|"summonerbarrier"|"summonerinspect" => Some(21),
        "exhaust"|"summonerexhaust" => Some(3),
        "ghost"|"summonerhaste"     => Some(6),
        "heal"|"summonerheal"       => Some(7),
        "cleanse"|"summonerboost"|"summonerraise" => Some(1),
        "smite"|"summonersmite"     => Some(11),
        "clarity"|"summonermana"    => Some(13),
        _ => None,
    }
}

fn rune_path_id(name: &str) -> Option<u32> {
    match name.to_lowercase().as_str() {
        "precision"   => Some(8000),
        "domination"  => Some(8100),
        "sorcery"     => Some(8200),
        "resolve"     => Some(8400),
        "inspiration" => Some(8300),
        _ => None,
    }
}

fn rune_name_to_id(name: &str) -> Option<u32> {
    match name.to_lowercase().replace(" ","").replace("'","").as_str() {
        "presstheattack" => Some(8005),
        "lethaltempolegacy"|"lethaltempo" => Some(8008),
        "fleetfootwork" => Some(8021),
        "conqueror" => Some(8010),
        "electrocute" => Some(8112),
        "predator" => Some(8124),
        "darkharvest" => Some(8128),
        "hailofblades" => Some(9923),
        "arcanecomet" => Some(8229),
        "phasherush" => Some(8230),
        "summonaery"|"summonaerie" => Some(8214),
        "graspoftheundying" => Some(8437),
        "aftershock" => Some(8439),
        "guardian" => Some(8465),
        "glacialaugment" => Some(8351),
        "unsealedspeelbook"|"unsealedspellbook" => Some(8360),
        "firstatrike" => Some(8369),
        "overheal" => Some(9101),
        "triumph" => Some(9111),
        "presenceofmind" => Some(8009),
        "legendalacrity" => Some(9104),
        "legendtenacity" => Some(9105),
        "legendbloodline" => Some(9103),
        "coupdegrace" => Some(8014),
        "cutdown" => Some(8017),
        "laststand" => Some(8299),
        "cheapshot" => Some(8126),
        "tasteofblood" => Some(8139),
        "suddenimpact" => Some(8143),
        "zombieward" => Some(8136),
        "ghostporo" => Some(8120),
        "eyeballcollection" => Some(8138),
        "relentlesshunter" => Some(8105),
        "ingenieoushunter"|"ingeniushunter" => Some(8106),
        "ultimatehunter" => Some(8135),
        "treasurehunter" => Some(8134),
        "nullifyingorb" => Some(8224),
        "manaflowband" => Some(8226),
        "nimbuscloak" => Some(8275),
        "transcendence" => Some(8210),
        "celerity" => Some(8234),
        "absolutefocus" => Some(8233),
        "scorch" => Some(8237),
        "waterwalking" => Some(8232),
        "gatheringstorm" => Some(8236),
        "demolish" => Some(8446),
        "fontoflife" => Some(8463),
        "shieldbash" => Some(8401),
        "conditioning" => Some(8429),
        "secondwind" => Some(8444),
        "boneplating" => Some(8473),
        "overgrowth" => Some(8451),
        "revitalize" => Some(8453),
        "unflinching" => Some(8242),
        "hextechflashtraption" => Some(8306),
        "magicalfootwear" => Some(8304),
        "perfecttiming" => Some(8313),
        "futuresmarket" => Some(8321),
        "miniondematerializer" => Some(8316),
        "biscuitdelivery" => Some(8345),
        "cosmicinsight" => Some(8347),
        "approachvelocity" => Some(8410),
        "timewarpedtonic" => Some(8352),
        _ => None,
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChampSelectSession {
    pub in_progress: bool,
    pub champion_name: String,
    pub assigned_position: String,
    /// "ranked" | "aram" | "urf" | "arurf" | "normal" — ricavato dal gameMode LCU
    pub game_mode: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub runes_imported: bool,
    pub summoners_imported: bool,
    pub items_imported: bool,
    pub rune_page_name: Option<String>,
    pub primary_path: Option<String>,
    pub summoner_spells: Vec<String>,
    pub item_blocks: Option<usize>,
    pub errors: Vec<String>,
}

/// Cerca il lockfile di League su tutte le lettere di drive possibili (C→Z).
fn get_lockfile_path() -> Option<PathBuf> {
    let suffixes = [
        r"Riot Games\League of Legends\lockfile",
        r"Program Files\Riot Games\League of Legends\lockfile",
        r"Program Files (x86)\Riot Games\League of Legends\lockfile",
        r"Games\League of Legends\lockfile",
        r"League of Legends\lockfile",
    ];
    for drive in 'C'..='Z' {
        for suffix in &suffixes {
            let path = PathBuf::from(format!(r"{}:\{}", drive, suffix));
            if path.exists() {
                eprintln!("[RLP] lockfile trovato: {:?}", path);
                return Some(path);
            }
        }
    }
    eprintln!("[RLP] lockfile non trovato su nessun drive (C:-Z:)");
    None
}

/// Cerca la cartella Config\Champions di League su tutte le lettere di drive (C→Z).
fn get_league_config_path() -> Option<PathBuf> {
    let suffixes = [
        r"Riot Games\League of Legends\Config\Champions",
        r"Program Files\Riot Games\League of Legends\Config\Champions",
        r"Program Files (x86)\Riot Games\League of Legends\Config\Champions",
        r"Games\League of Legends\Config\Champions",
        r"League of Legends\Config\Champions",
    ];
    for drive in 'C'..='Z' {
        for suffix in &suffixes {
            let path = PathBuf::from(format!(r"{}:\{}", drive, suffix));
            if path.exists() {
                eprintln!("[RLP] config path trovato: {:?}", path);
                return Some(path);
            }
        }
    }
    eprintln!("[RLP] config path non trovato su nessun drive (C:-Z:)");
    None
}

struct LcuClient { client: Client, port: String, auth: String }

impl LcuClient {
    fn new() -> Option<Self> {
        let content = fs::read_to_string(get_lockfile_path()?).ok()?;
        let parts: Vec<&str> = content.split(':').collect();
        if parts.len() < 4 { return None; }
        let port = parts[2].to_string();
        let password = parts[3].to_string();
        let auth = general_purpose::STANDARD.encode(format!("riot:{}", password));
        let client = Client::builder().danger_accept_invalid_certs(true).build().ok()?;
        Some(LcuClient { client, port, auth })
    }
    async fn get(&self, path: &str) -> Option<Value> {
        self.client.get(&format!("https://127.0.0.1:{}{}", self.port, path))
            .header("Authorization", format!("Basic {}", self.auth))
            .send().await.ok()?.json().await.ok()
    }
    async fn put(&self, path: &str, body: &Value) -> Option<Value> {
        self.client.put(&format!("https://127.0.0.1:{}{}", self.port, path))
            .header("Authorization", format!("Basic {}", self.auth))
            .json(body).send().await.ok()?.json().await.ok()
    }
    async fn post(&self, path: &str, body: &Value) -> Option<Value> {
        self.client.post(&format!("https://127.0.0.1:{}{}", self.port, path))
            .header("Authorization", format!("Basic {}", self.auth))
            .json(body).send().await.ok()?.json().await.ok()
    }
    async fn post_status(&self, path: &str, body: &Value) -> Result<u16, String> {
        let resp = self.client.post(&format!("https://127.0.0.1:{}{}", self.port, path))
            .header("Authorization", format!("Basic {}", self.auth))
            .json(body).send().await.map_err(|e| e.to_string())?;
        Ok(resp.status().as_u16())
    }
}

async fn mcp_extract_text(text: &str) -> Option<String> {
    for line in text.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if let Ok(p) = serde_json::from_str::<Value>(data) {
                if p.get("error").is_some() { continue; }
                if let Some(c) = p["result"]["content"].as_array() {
                    for item in c { if item["type"]=="text" { return item["text"].as_str().map(String::from); } }
                }
            }
        }
    }
    if let Ok(p) = serde_json::from_str::<Value>(text) {
        if p.get("error").is_none() {
            if let Some(c) = p["result"]["content"].as_array() {
                for item in c { if item["type"]=="text" { return item["text"].as_str().map(String::from); } }
            }
        }
    }
    None
}

async fn opgg_get_champion_build(champion_name: &str, position: &str, game_mode: &str) -> Result<Value, String> {
    eprintln!("[RLP] opgg_get_champion_build: {} {} (mode={})", champion_name, position, game_mode);

    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().map_err(|e| e.to_string())?;

    // Per ranked usiamo la lane reale. Per ARAM/URF proviamo i valori accettati dall'API in ordine.
    let pos_ranked = match position.to_uppercase().as_str() {
        "TOP"                     => "top",
        "JUNGLE"                  => "jungle",
        "MIDDLE"|"MID"            => "mid",
        "BOTTOM"|"BOT"|"ADC"      => "adc",
        "SUPPORT"|"UTILITY"       => "support",
        _                         => "mid",
    };
    // Per URF/ARAM l'API OP.GG ha un bug: non accetta nessun valore di position
    // con game_mode=urf/aram. Workaround: usiamo sempre game_mode=ranked + posizione reale.
    // L'item set sarà comunque utile perché gli item in URF sono gli stessi di ranked.
    let opgg_mode = "ranked"; // sempre ranked — workaround bug API OP.GG
    let champ_upper = champion_name.to_uppercase();
    const MCP_URL: &str = "https://mcp-api.op.gg/mcp";

    let init_res = client.post(MCP_URL)
        .header("Content-Type","application/json")
        .header("Accept","application/json, text/event-stream")
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
            "protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"rlp","version":"1.0"}
        }}))
        .send().await.map_err(|e| format!("init error: {}", e))?;

    let session_id = init_res.headers().get("mcp-session-id")
        .and_then(|v| v.to_str().ok()).map(String::from);
    let _ = init_res.text().await;

    {
        let mut r = client.post(MCP_URL).header("Content-Type","application/json");
        if let Some(ref sid) = session_id { r = r.header("mcp-session-id", sid.as_str()); }
        let _ = r.json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"})).send().await;
    }

    // Costruisce gli arguments e invia la request, con retry per trovare il valore position corretto
    let desired_fields = json!([
        "data.summoner_spells.{ids,ids_names}",
        "data.runes.{primary_page_id,primary_page_name,primary_rune_ids,secondary_page_id,secondary_page_name,secondary_rune_ids,stat_mod_ids}",
        "data.starter_items[].{ids,ids_names}",
        "data.core_items[].{ids,ids_names}",
        "data.last_items[].{ids,ids_names}",
        "data.fourth_items[].{ids,ids_names}",
        "data.fifth_items[].{ids,ids_names}",
        "data.sixth_items[].{ids,ids_names}",
        "data.boots[].{ids,ids_names}",
        "data.skills.{order}",
        "data.mythic_items[].{ids,ids_names}"
    ]);

    let mut req = client.post(MCP_URL)
        .header("Content-Type","application/json")
        .header("Accept","application/json, text/event-stream");
    if let Some(ref sid) = session_id { req = req.header("mcp-session-id", sid.as_str()); }

    eprintln!("[RLP] MCP attempt: champion={} game_mode=ranked position={}", champ_upper, pos_ranked);

    let mut args = serde_json::Map::new();
    args.insert("champion".to_string(), json!(champ_upper));
    args.insert("game_mode".to_string(), json!(opgg_mode));
    args.insert("position".to_string(), json!(pos_ranked));
    args.insert("lang".to_string(), json!("en_US"));
    args.insert("desired_output_fields".to_string(), desired_fields.clone());

    let res = req.json(&json!({
        "jsonrpc":"2.0","id":2,"method":"tools/call",
        "params":{"name":"lol_get_champion_analysis","arguments": Value::Object(args)}
    })).send().await.map_err(|e| format!("HTTP error: {}", e))?;

    let text = res.text().await.map_err(|e| e.to_string())?;

    if let Ok(p) = serde_json::from_str::<Value>(&text) {
        if let Some(err) = p.get("error") {
            return Err(format!("MCP tool error: {}", err));
        }
    }

    let mut text_content = String::new();
    let last_err;
    match mcp_extract_text(&text).await {
        Some(tc) => {
            eprintln!("[RLP] MCP success pos={}", pos_ranked);
            text_content = tc;
            last_err = String::new();
        }
        None => {
            last_err = format!("No text in MCP response (pos={})", pos_ranked);
            eprintln!("[RLP] {}", last_err);
        }
    }

    if text_content.is_empty() {
        return Err(if last_err.is_empty() { "Risposta MCP vuota".to_string() } else { last_err });
    }

    // Log full text_content in chunks
    let mut _off = 0;
    while _off < text_content.len() {
        let _end = (_off + 500).min(text_content.len());
        eprintln!("[RLP] tc[{}-{}]: {:?}", _off, _end, &text_content[_off.._end]);
        _off = _end;
    }
    parse_opgg_response(&text_content)
}

fn extract_numbers(s: &str) -> Vec<u64> {
    let mut nums = Vec::new();
    let mut i = 0;
    let bytes = s.as_bytes();
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
            if let Ok(n) = s[start..i].parse::<u64>() { nums.push(n); }
        } else { i += 1; }
    }
    nums
}

fn extract_array_content<'a>(s: &'a str, after: &str) -> Option<&'a str> {
    let pos = s.find(after)?;
    let rest = &s[pos + after.len()..];
    let start = rest.find('[')?;
    let mut depth = 0i32;
    let chars: Vec<char> = rest[start..].chars().collect();
    let mut end = 0;
    for (i, &c) in chars.iter().enumerate() {
        if c == '[' { depth += 1; } else if c == ']' { depth -= 1; if depth == 0 { end = i; break; } }
    }
    if end > 0 { Some(&rest[start..start+end+1]) } else { None }
}

fn parse_opgg_response(text: &str) -> Result<Value, String> {
    let (primary_page_id, sub_page_id, primary_rune_ids, sub_rune_ids, stat_mod_ids) = {
        // Formato attuale: Runes(primary_id,"primary_name",[primary_runes],sub_id,"sub_name",[sub_runes],[stat_mods])
        // Es: Runes(8000,"Precision",[8008,9111,9103,8017],8300,"Inspiration",[8313,8321],[5005,5008,5011])
        let runes_start = text.find("Runes(").ok_or("Runes( non trovato")?;
        let runes_section = &text[runes_start + "Runes(".len()..];

        // Trova tutti gli array [...] dentro Runes(...)
        // Array[0] = primary_rune_ids, Array[1] = sub_rune_ids, Array[2] = stat_mod_ids
        let mut arrays: Vec<Vec<u32>> = Vec::new();
        let mut scalars_before: Vec<Vec<u64>> = Vec::new(); // scalari prima di ogni array
        let mut pos = 0;
        let rbytes = runes_section.as_bytes();
        let mut current_scalars = String::new();
        while pos < rbytes.len() && arrays.len() < 3 {
            if rbytes[pos] == b'[' {
                // Salva gli scalari accumulati prima di questo array
                scalars_before.push(extract_numbers(&current_scalars));
                current_scalars.clear();
                // Leggi l'array
                let start = pos + 1;
                pos += 1;
                while pos < rbytes.len() && rbytes[pos] != b']' { pos += 1; }
                let arr_str = &runes_section[start..pos];
                arrays.push(arr_str.split(',').filter_map(|x| x.trim().parse::<u32>().ok()).collect());
                pos += 1; // salta ]
            } else if rbytes[pos] == b')' {
                break; // fine Runes(...)
            } else {
                current_scalars.push(rbytes[pos] as char);
                pos += 1;
            }
        }

        // scalars_before[0] = testo prima del primo array → contiene primary_page_id
        // scalars_before[1] = testo tra primo e secondo array → contiene sub_page_id
        let primary_page_id = scalars_before.get(0).and_then(|v| v.get(0)).copied().unwrap_or(8000) as u32;
        let sub_page_id     = scalars_before.get(1).and_then(|v| v.get(0)).copied().unwrap_or(8300) as u32;
        let primary_ids = arrays.get(0).cloned().unwrap_or_default();
        let sec_ids     = arrays.get(1).cloned().unwrap_or_default();
        let stat_ids    = arrays.get(2).cloned().unwrap_or_else(|| vec![5008,5008,5002]);

        eprintln!("[RLP] runes parsed: primary={} sub={} primary_ids={:?} sub_ids={:?} stat={:?}",
            primary_page_id, sub_page_id, primary_ids, sec_ids, stat_ids);

        (primary_page_id, sub_page_id, primary_ids, sec_ids, stat_ids)
    };

    let summoner_spells: Value = {
        fn spell_id_to_name(id: u64) -> &'static str {
            match id {
                4=>"Flash", 14=>"Ignite", 12=>"Teleport", 21=>"Barrier", 3=>"Exhaust",
                6=>"Ghost", 7=>"Heal", 1=>"Cleanse", 11=>"Smite", 13=>"Clarity", 32=>"Mark",
                _=>"Flash",
            }
        }
        let mut names: Vec<Value> = Vec::new();
        if let Some(pos) = text.find("SummonerSpells(") {
            let section = &text[pos+"SummonerSpells(".len()..];
            if let Some(bracket_start) = section.find('[') {
                let bracket_section = &section[bracket_start..];
                if let Some(bracket_end) = bracket_section.find(']') {
                    let ids_str = &bracket_section[1..bracket_end];
                    for id_str in ids_str.split(',') {
                        if let Ok(id) = id_str.trim().parse::<u64>() { names.push(json!(spell_id_to_name(id))); }
                    }
                }
            }
        }
        if names.len() >= 2 { json!([names[0].clone(), names[1].clone()]) } else { json!(["Flash","Heal"]) }
    };

    fn to_items(ids: &[u64]) -> Value {
        Value::Array(ids.iter().map(|&id| json!({"id": id})).collect())
    }

    // Estrae tutti gli ID item da una stringa che contiene SummonerSpells(...)
    fn extract_item_ids_from_group(group: &str) -> Vec<u64> {
        let mut ids = Vec::new();
        let mut search = group;
        while let Some(pos) = search.find("SummonerSpells(") {
            search = &search[pos + "SummonerSpells(".len()..];
            if let Some(b_start) = search.find('[') {
                let s = &search[b_start+1..];
                if let Some(b_end) = s.find(']') {
                    for x in s[..b_end].split(',') {
                        if let Ok(id) = x.trim().parse::<u64>() {
                            if id > 100 && id < 500000 { ids.push(id); }
                        }
                    }
                }
            }
        }
        ids
    }

    // ── Parser strutturale ────────────────────────────────────────────────────
    // La risposta OP.GG ha questa struttura nel testo:
    //   Data(
    //     SummonerSpells([spells]),          ← summoner spells
    //     Runes(...),                        ← rune
    //     SummonerSpells([starter]),         ← starter items (blocco singolo)
    //     SummonerSpells([core_1,core_2,..]),← core build principale (blocco singolo con più item)
    //     [SummonerSpells([c]),..],          ← varianti core (gruppo tra [])
    //     [SummonerSpells([d]),..],          ← 4th item options (gruppo tra [])
    //     [SummonerSpells([e]),..],          ← 5th item options
    //     [SummonerSpells([f]),..],          ← 6th item options
    //     SummonerSpells([boots]),           ← boots (blocco singolo)
    //     Skills([...]),                     ← skill order
    //   )
    //
    // Strategia: troviamo la sezione Data(...) e separiamo i token top-level
    // distinguendo blocchi singoli SummonerSpells(...) da gruppi [...].

    let data_start = text.find("LolGetChampionAnalysis(").unwrap_or(0);
    let data_section = &text[data_start..];

    // Raccogli i "token" top-level dopo Runes(...):
    // - "single": un SummonerSpells singolo  → starter, core, boots
    // - "group":  una lista [...] di SummonerSpells → varianti core, 4th, 5th, 6th
    #[derive(Debug)]
    enum Token { Single(Vec<u64>), Group(Vec<u64>) }

    let mut tokens: Vec<Token> = Vec::new();
    let mut runes_end = 0;
    // Salta fino a dopo Runes(...)
    if let Some(rp) = data_section.find("Runes(") {
        let mut depth = 0i32;
        let bytes = data_section[rp..].as_bytes();
        for (i, &b) in bytes.iter().enumerate() {
            if b == b'(' { depth += 1; }
            else if b == b')' { depth -= 1; if depth == 0 { runes_end = rp + i + 1; break; } }
        }
    }
    let after_runes = if runes_end > 0 { &data_section[runes_end..] } else { data_section };

    // Scansione carattere per carattere dei token top-level
    let bytes = after_runes.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'[' => {
                // Gruppo: trova il ] di chiusura al livello 0
                let start = i + 1;
                let mut depth = 1i32;
                i += 1;
                while i < bytes.len() && depth > 0 {
                    if bytes[i] == b'[' { depth += 1; }
                    else if bytes[i] == b']' { depth -= 1; }
                    i += 1;
                }
                let group_str = &after_runes[start..i-1];
                let ids = extract_item_ids_from_group(group_str);
                if !ids.is_empty() { tokens.push(Token::Group(ids)); }
            }
            b'S' if after_runes[i..].starts_with("StarterItems(") || after_runes[i..].starts_with("SummonerSpells(") => {
                // Blocco singolo: StarterItems( oppure SummonerSpells( fuori da gruppi []
                // Determina la lunghezza del prefisso
                let prefix_len = if after_runes[i..].starts_with("StarterItems(") {
                    "StarterItems(".len()
                } else {
                    "SummonerSpells(".len()
                };
                let sp_start = i + prefix_len;
                if let Some(bracket) = after_runes[sp_start..].find('[') {
                    let s = &after_runes[sp_start + bracket + 1..];
                    if let Some(end) = s.find(']') {
                        let ids: Vec<u64> = s[..end].split(',')
                            .filter_map(|x| x.trim().parse::<u64>().ok())
                            .filter(|&id| id > 100 && id < 500000)
                            .collect();
                        if !ids.is_empty() { tokens.push(Token::Single(ids)); }
                    }
                }
                // Avanza oltre questo blocco
                while i < bytes.len() && bytes[i] != b')' { i += 1; }
                i += 1;
            }
            b'S' if after_runes[i..].starts_with("Skills(") => { break; } // fine dati item
            _ => { i += 1; }
        }
    }

    eprintln!("[RLP] tokens strutturali: {:?}", tokens);

    // Classifica i token:
    // Single[0] = starter, Single[1] = core principale, Single[last] = boots
    // Group[0] = varianti core, Group[1] = 4th, Group[2] = 5th, Group[3] = 6th
    let singles: Vec<&Vec<u64>> = tokens.iter().filter_map(|t| if let Token::Single(v) = t { Some(v) } else { None }).collect();
    let groups:  Vec<&Vec<u64>> = tokens.iter().filter_map(|t| if let Token::Group(v)  = t { Some(v) } else { None }).collect();

    let empty: Vec<u64> = vec![];
    let starter = singles.get(0).copied().unwrap_or(&empty);
    let core    = singles.get(1).copied().unwrap_or(&empty);
    let boots   = singles.last().filter(|_| singles.len() > 2).copied().unwrap_or(&empty);

    // Gruppi: [0]=varianti core (mostriamo come "Core Variants"),
    //         [1]=4th, [2]=5th, [3]=6th
    // slot_labels: etichette per i gruppi OP.GG
    // Group[0] = varianti core (3rd item), Group[1] = 4th, Group[2] = 5th, Group[3] = 6th
    let slot_labels = [("3rd Item Options", 0usize), ("4th Item", 1), ("5th Item", 2), ("6th Item", 3)];
    let mut slots: Vec<Value> = Vec::new();
    // Teniamo traccia di tutti gli ID già usati nei blocchi precedenti per evitare duplicati
    let mut seen_ids: std::collections::HashSet<u64> = std::collections::HashSet::new();
    // Aggiungi gli ID di starter e core come "già visti"
    for &id in starter.iter().chain(core.iter()).chain(boots.iter()) { seen_ids.insert(id); }

    for (label, idx) in &slot_labels {
        if let Some(raw_ids) = groups.get(*idx) {
            // Filtra gli ID già presenti nei blocchi precedenti
            let ids: Vec<u64> = raw_ids.iter().copied().filter(|id| !seen_ids.contains(id)).collect();
            if !ids.is_empty() {
                for &id in &ids { seen_ids.insert(id); }
                slots.push(json!({"label": label, "items": to_items(&ids)}));
            }
        }
    }

    eprintln!("[RLP] starter={:?} core={:?} boots={:?} slots={}", starter, core, boots, slots.len());

    // Parse skill order
    let skill_order = {
        let mut order = String::new();
        if let Some(pos) = text.find("Skills(") {
            let section = &text[pos + "Skills(".len()..];
            if let Some(end) = section.find(')') {
                let inner = &section[..end];
                let mut seen: Vec<String> = Vec::new();
                for token in inner.split(|c: char| !c.is_alphanumeric()) {
                    let t = token.trim().to_uppercase();
                    if (t == "Q" || t == "W" || t == "E") && !seen.contains(&t) {
                        seen.push(t);
                        if seen.len() == 3 { break; }
                    }
                }
                if seen.len() == 3 {
                    order = format!("{} → {} → {}", seen[0], seen[1], seen[2]);
                }
                eprintln!("[RLP] skill_order inner={:?} → {:?}", &inner[..inner.len().min(80)], order);
            }
        }
        order
    };

    Ok(json!({
        "data": {
            "runes": {
                "primary_page_id": primary_page_id, "sub_page_id": sub_page_id,
                "primary_rune_ids": primary_rune_ids, "sub_rune_ids": sub_rune_ids,
                "stat_mod_ids": stat_mod_ids
            },
            "summoner_spells": summoner_spells,
            "starter_items":   to_items(starter),
            "core_items":      to_items(core),
            "situ_slots":      Value::Array(slots),
            "boots":           to_items(boots),
            "skill_order":     skill_order
        }
    }))
}

async fn import_runes(lcu: &LcuClient, champion: &str, position: &str, build: &Value) -> Result<(String,String),String> {
    let rune_data = build.pointer("/data/runes").or_else(|| build.get("runes")).ok_or("Rune non trovate")?;
    let primary_id = rune_data["primary_page_id"].as_u64().map(|n| n as u32).unwrap_or(8000);
    let sub_id = rune_data["sub_page_id"].as_u64().map(|n| n as u32).unwrap_or(8100);
    let primary_path_name = rune_data["primary_page_id"].as_str().unwrap_or("Precision");
    let primary_ids: Vec<u32> = rune_data["primary_rune_ids"].as_array().unwrap_or(&vec![]).iter().filter_map(|v| v.as_u64().map(|n| n as u32)).collect();
    let sub_ids: Vec<u32> = rune_data["sub_rune_ids"].as_array().unwrap_or(&vec![]).iter().filter_map(|v| v.as_u64().map(|n| n as u32)).collect();
    let stat_ids: Vec<u32> = rune_data["stat_mod_ids"].as_array().map(|a| a.iter().filter_map(|v| v.as_u64().map(|n| n as u32)).collect()).unwrap_or_else(|| vec![5008,5008,5002]);
    
    let page_name = format!("RLP {} {}", champion, position);
    let pages: Vec<Value> = lcu.get("/lol-perks/v1/pages").await.and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let editable: Vec<&Value> = pages.iter().filter(|p| p["isDeletable"].as_bool().unwrap_or(false)).collect();
    let del_id = editable.iter().find(|p| p["name"].as_str().unwrap_or("")==page_name).or_else(|| editable.first()).and_then(|p| p["id"].as_u64());
    
    if let Some(id) = del_id {
        let _ = lcu.client.delete(&format!("https://127.0.0.1:{}/lol-perks/v1/pages/{}", lcu.port, id))
            .header("Authorization", format!("Basic {}", lcu.auth)).send().await;
    }
    
    let mut perks = Vec::new();
    perks.extend_from_slice(&primary_ids);
    perks.extend_from_slice(&sub_ids);
    perks.extend_from_slice(&stat_ids);
    
    // Usa post_status invece di post: il LCU in URF/ARAM risponde con body vuoto (non JSON),
    // quindi controllare solo lo status code HTTP è l'unico modo affidabile.
    let status = lcu.post_status("/lol-perks/v1/pages", &json!({
        "name": page_name, "primaryStyleId": primary_id, "subStyleId": sub_id,
        "selectedPerkIds": perks, "current": true
    })).await.map_err(|e| format!("HTTP error rune page: {}", e))?;

    eprintln!("[RLP] import_runes POST status={}", status);
    if status < 200 || status >= 300 {
        return Err(format!("Il client ha rifiutato la pagina rune (HTTP {})", status));
    }
    Ok((page_name, primary_path_name.to_string()))
}

async fn import_summoners(lcu: &LcuClient, build: &Value) -> Result<Vec<String>,String> {
    let spells_raw = build.pointer("/data/summoner_spells").and_then(|v| v.as_array()).ok_or("Summoner spells non trovate")?;
    let spell_names: Vec<String> = spells_raw.iter().filter_map(|v| v.as_str().map(String::from)).collect();
    if spell_names.len() < 2 { return Err(format!("Meno di 2 spell")); }
    let id1 = spell_name_to_id(&spell_names[0]).unwrap_or(4);
    let id2 = spell_name_to_id(&spell_names[1]).unwrap_or(7);
    
    let resp = lcu.client.patch(&format!("https://127.0.0.1:{}/lol-champ-select/v1/session/my-selection", lcu.port))
        .header("Authorization", format!("Basic {}", lcu.auth)).header("Content-Type","application/json")
        .json(&json!({"spell1Id":id1,"spell2Id":id2})).send().await.map_err(|e| e.to_string())?;
        
    if resp.status().is_success() { Ok(spell_names) } else { Err("Il client ha rifiutato il cambio spell".to_string()) }
}

async fn import_item_set(_lcu: &LcuClient, champion: &str, position: &str, build: &Value, _puuid: &str, label_override: Option<&str>) -> Result<usize,String> {
    let mut blocks: Vec<Value> = Vec::new();

    let skill_order = build.pointer("/data/skill_order")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let core_label = if skill_order.is_empty() {
        "Core Build".to_string()
    } else {
        format!("Core Build  |  {}", skill_order)
    };

    let make_block = |label: &str, ids: Vec<u64>| -> Option<Value> {
        if ids.is_empty() { return None; }
        Some(json!({
            "type": label,
            "recMath": false,
            "minSummonerLevel": -1,
            "maxSummonerLevel": -1,
            "showIfSummonerSpell": "",
            "hideIfSummonerSpell": "",
            "items": ids.iter().map(|id| json!({"id": id.to_string(), "count": 1})).collect::<Vec<_>>()
        }))
    };

    // 1. Starter Items
    if let Some(arr) = build.pointer("/data/starter_items").and_then(|v| v.as_array()) {
        let ids: Vec<u64> = arr.iter().filter_map(|v| v["id"].as_u64()).collect();
        if let Some(b) = make_block("Starter Items", ids) { blocks.push(b); }
    }

    // 2. Core Build + skill order
    if let Some(arr) = build.pointer("/data/core_items").and_then(|v| v.as_array()) {
        let ids: Vec<u64> = arr.iter().filter_map(|v| v["id"].as_u64()).collect();
        if let Some(b) = make_block(&core_label, ids) { blocks.push(b); }
    }

    // 3. Slot situazionali: Core Variants → 4th → 5th → 6th
    // Ordine finale: Starter → Core | skill order → Core Variants → 4th → 5th → 6th → Boots
    if let Some(situ_slots) = build.pointer("/data/situ_slots").and_then(|v| v.as_array()) {
        for slot in situ_slots {
            let label = slot["label"].as_str().unwrap_or("Situational");
            if let Some(items_arr) = slot["items"].as_array() {
                let ids: Vec<u64> = items_arr.iter().filter_map(|v| v["id"].as_u64()).collect();
                if let Some(b) = make_block(label, ids) { blocks.push(b); }
            }
        }
    }

    // 4. Boots — ultimo
    if let Some(arr) = build.pointer("/data/boots").and_then(|v| v.as_array()) {
        let ids: Vec<u64> = arr.iter().filter_map(|v| v["id"].as_u64()).collect();
        if let Some(b) = make_block("Boots", ids) { blocks.push(b); }
    }

    if blocks.is_empty() { return Err("Nessun item trovato".to_string()); }
    let count = blocks.len();

    let set_title = label_override.map(String::from).unwrap_or_else(|| format!("RLP {} {}", champion, position));
    let item_set = json!({
        "title": set_title,
        "type": "custom",
        "map": "any",
        "mode": "any",
        "priority": false,
        "sortrank": 1,
        "blocks": blocks
    });

    // Usa il path dinamico invece del path hardcoded
    let config_path = get_league_config_path()
        .ok_or("Cartella League of Legends non trovata su nessun drive (C:-Z:)")?
        .join(champion)
        .join("Recommended");

    fs::create_dir_all(&config_path).map_err(|e| format!("mkdir error: {}", e))?;
    let filename = label_override
        .map(|l| format!("RLP_{}.json", l.replace(' ', "_").replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")))
        .unwrap_or_else(|| "RLP.json".to_string());
    let file_path = config_path.join(&filename);
    let json_str = serde_json::to_string_pretty(&item_set).map_err(|e| e.to_string())?;
    fs::write(&file_path, &json_str).map_err(|e| format!("write error: {}", e))?;

    eprintln!("[RLP] item-set written: {:?} ({} blocks)", file_path, count);
    Ok(count)
}

/// Per URF/ARAM: fetch parallelo delle build per le 4 lane principali usando ranked come workaround.
/// Restituisce un Vec<(lane_label, build_value)> per le lane che hanno risposto con successo.
async fn opgg_get_builds_multi_lane(champion_name: &str) -> Vec<(String, Value)> {
    let lanes = [
        ("MID",     "mid"),
        ("TOP",     "top"),
        ("JUNGLE",  "jungle"),
        ("ADC",     "adc"),
        ("SUPPORT", "support"),
    ];

    let mut handles = Vec::new();
    for (label, pos) in &lanes {
        let champ = champion_name.to_string();
        let label = label.to_string();
        let pos   = pos.to_string();
        handles.push(tokio::spawn(async move {
            match opgg_get_champion_build(&champ, &pos, "ranked").await {
                Ok(build) => Some((label, build)),
                Err(e) => {
                    eprintln!("[RLP] multi-lane {} fetch failed: {}", pos, e);
                    None
                }
            }
        }));
    }

    let mut results = Vec::new();
    for h in handles {
        if let Ok(Some(pair)) = h.await { results.push(pair); }
    }
    results
}

#[tauri::command]
pub async fn get_champ_select_session() -> Result<ChampSelectSession, String> {
    let lcu = LcuClient::new().ok_or("CLIENT_CLOSED")?;
    let session: Value = lcu.get("/lol-champ-select/v1/session").await.ok_or("Nessuna champion select attiva")?;
    if session.get("errorCode").is_some() {
        return Ok(ChampSelectSession { in_progress:false, champion_name:String::new(), assigned_position:String::new(), game_mode:String::new() });
    }
    let my_cell = session["localPlayerCellId"].as_i64().unwrap_or(-1);
    let my_slot = session["myTeam"].as_array().and_then(|team| team.iter().find(|p| p["cellId"].as_i64()==Some(my_cell)));
    let assigned_position = my_slot.and_then(|s| s["assignedPosition"].as_str()).unwrap_or("MIDDLE").to_uppercase();
    let mut champ_id = my_slot.and_then(|s| s["championId"].as_u64().or_else(|| s["championPickIntent"].as_u64())).unwrap_or(0);
    
    if champ_id == 0 {
        if let Some(phases) = session["actions"].as_array() {
            'outer: for phase in phases {
                if let Some(actions) = phase.as_array() {
                    for action in actions {
                        if action["actorCellId"].as_i64()==Some(my_cell) && action["type"].as_str()==Some("pick") {
                            if let Some(id) = action["championId"].as_u64() { if id!=0 { champ_id=id; break 'outer; } }
                        }
                    }
                }
            }
        }
    }
    // Legge il game mode dalla sessione LCU (gameConfig.gameMode)
    let game_config: Value = lcu.get("/lol-gameflow/v1/session").await.unwrap_or(json!({}));
    let raw_mode = game_config
        .pointer("/gameData/queue/gameMode")
        .or_else(|| game_config.pointer("/gameData/gameTypeConfig/name"))
        .and_then(|v| v.as_str())
        .unwrap_or("CLASSIC")
        .to_uppercase();
    let game_mode = match raw_mode.as_str() {
        "ARAM"                   => "aram",
        "URF" | "ONEFORALL"      => "urf",
        "ARURF"                  => "urf",
        "ULTBOOK"                => "urf",  // Ultimate Spellbook — usa build URF
        _                        => "ranked",
    }.to_string();
    eprintln!("[RLP] gameMode LCU raw={} → {}", raw_mode, game_mode);

    if champ_id == 0 {
        return Ok(ChampSelectSession { in_progress:true, champion_name:String::new(), assigned_position, game_mode });
    }
    
    let http = Client::builder().danger_accept_invalid_certs(true).build().unwrap();
    let champs: Value = http.get(&format!("https://ddragon.leagueoflegends.com/cdn/{}/data/en_US/champion.json", PATCH))
        .send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        
    let champion_name = champs["data"].as_object()
        .and_then(|map| map.values().find(|c| c["key"].as_str().map(|k| k==champ_id.to_string()).unwrap_or(false)))
        .and_then(|c| c["id"].as_str()).unwrap_or("Unknown").to_string();
        
    Ok(ChampSelectSession { in_progress:true, champion_name, assigned_position, game_mode })
}

#[tauri::command]
pub async fn debug_champ_select_slot() -> Result<Value, String> {
    let lcu = LcuClient::new().ok_or("CLIENT_CLOSED")?;
    let session: Value = lcu.get("/lol-champ-select/v1/session").await.ok_or("Nessuna champion select attiva")?;
    if session.get("errorCode").is_some() { return Err("Non in champion select".to_string()); }
    let my_cell = session["localPlayerCellId"].as_i64().unwrap_or(-1);
    let my_slot = session["myTeam"].as_array()
        .and_then(|team| team.iter().find(|p| p["cellId"].as_i64()==Some(my_cell)))
        .cloned().unwrap_or(json!({}));
    let my_actions: Vec<Value> = session["actions"].as_array().map(|phases|
        phases.iter().filter_map(|p| p.as_array()).flat_map(|a| a.iter().cloned())
            .filter(|a| a["actorCellId"].as_i64()==Some(my_cell)).collect()
    ).unwrap_or_default();
    Ok(json!({"my_slot":my_slot,"my_actions":my_actions,"localPlayerCellId":my_cell}))
}

#[tauri::command]
pub async fn auto_import_build(champion_name: String, assigned_position: String, game_mode: String) -> Result<ImportResult, String> {
    eprintln!("[RLP] auto_import_build: {} {} mode={}", champion_name, assigned_position, game_mode);
    let mut result = ImportResult {
        runes_imported:false, summoners_imported:false, items_imported:false,
        rune_page_name:None, primary_path:None, summoner_spells:Vec::new(), item_blocks:None, errors:Vec::new(),
    };
    
    let lcu = match LcuClient::new() {
        Some(c) => c,
        None => { result.errors.push("Client LoL non disponibile".to_string()); return Ok(result); }
    };

    // Normalizza game_mode (il frontend manda quello che viene dalla sessione)
    let mode = match game_mode.to_lowercase().as_str() {
        "aram"  => "aram",
        "urf" | "arurf" | "ultbook" | "oneforall" => "urf",
        _       => "ranked",
    };

    // Label leggibile per rune page e item set title
    let mode_label = match mode {
        "aram"   => "ARAM",
        "urf"    => "URF",
        _        => &assigned_position,
    };
    
    let summoner: Value = lcu.get("/lol-summoner/v1/current-summoner").await.unwrap_or(json!({}));
    let puuid = summoner["puuid"].as_str().unwrap_or("").to_string();
    eprintln!("[RLP] summoner puuid={}", puuid);

    if mode == "ranked" || mode == "flex" {
        // ── RANKED / FLEX: build singola per la lane assegnata ────────────────
        let build = match opgg_get_champion_build(&champion_name, &assigned_position, mode).await {
            Ok(b) => b,
            Err(e) => { result.errors.push(format!("OP.GG fetch fallito: {}", e)); return Ok(result); }
        };

        match import_runes(&lcu, &champion_name, mode_label, &build).await {
            Ok((name,path)) => { result.runes_imported=true; result.rune_page_name=Some(name); result.primary_path=Some(path); }
            Err(e) => result.errors.push(format!("Rune: {}", e)),
        }
        match import_summoners(&lcu, &build).await {
            Ok(spells) => { result.summoners_imported=true; result.summoner_spells=spells; }
            Err(e) => result.errors.push(format!("Summoners: {}", e)),
        }
        match import_item_set(&lcu, &champion_name, mode_label, &build, &puuid, None).await {
            Ok(blocks) => { result.items_imported=true; result.item_blocks=Some(blocks); }
            Err(e) => result.errors.push(format!("Item set: {}", e)),
        }
    } else {
        // ── URF / ARAM / altre modalità: fetch parallelo per tutte le lane ────
        // L'API OP.GG non accetta game_mode=urf/aram; usiamo ranked come workaround.
        eprintln!("[RLP] mode={} → multi-lane fetch", mode);
        let lane_builds = opgg_get_builds_multi_lane(&champion_name).await;

        if lane_builds.is_empty() {
            result.errors.push("Nessuna build multi-lane disponibile".to_string());
            return Ok(result);
        }

        // Rune: usiamo la build MID (prima dell'array, o la prima disponibile)
        let rune_build = lane_builds.iter()
            .find(|(l, _)| l == "MID")
            .or_else(|| lane_builds.first());
        if let Some((rune_lane, build)) = rune_build {
            let rune_label = format!("{} {}", mode_label, rune_lane);
            match import_runes(&lcu, &champion_name, &rune_label, build).await {
                Ok((name,path)) => { result.runes_imported=true; result.rune_page_name=Some(name); result.primary_path=Some(path); }
                Err(e) => result.errors.push(format!("Rune: {}", e)),
            }
        }

        // Summoner spells: skip in modalità non-ranked (LCU non lo permette)
        result.summoners_imported = true;
        eprintln!("[RLP] Summoner spells skip (mode={})", mode);

        // Item set: uno per ogni lane riuscita
        let mut total_blocks = 0usize;
        let mut item_errors = Vec::new();
        for (lane_label, build) in &lane_builds {
            let set_label = format!("RLP {} {} {}", champion_name, mode_label, lane_label);
            match import_item_set(&lcu, &champion_name, lane_label, build, &puuid, Some(&set_label)).await {
                Ok(blocks) => { total_blocks += blocks; }
                Err(e) => { item_errors.push(format!("{}: {}", lane_label, e)); }
            }
        }
        if total_blocks > 0 {
            result.items_imported = true;
            result.item_blocks = Some(total_blocks);
        }
        if !item_errors.is_empty() {
            result.errors.push(format!("Item set parziale: {}", item_errors.join("; ")));
        }
    }

    if !result.errors.is_empty() {
        eprintln!("\n[RLP] ⚠️ ERRORI RILEVATI DURANTE L'IMPORTAZIONE:\n{:#?}\n", result.errors);
    }
    
    Ok(result)
}