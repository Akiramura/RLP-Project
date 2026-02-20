// ─────────────────────────────────────────────────────────────────────────────
// champ_select.rs  —  auto-import rune / summoners / item set
//
// Aggiungere a main.rs:
//   mod champ_select;
//   use champ_select::{get_champ_select_session, auto_import_build, debug_champ_select_slot};
//
// E nel .invoke_handler:
//   get_champ_select_session, auto_import_build, debug_champ_select_slot
// ─────────────────────────────────────────────────────────────────────────────

use reqwest::Client;
use serde_json::{json, Value};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use base64::{engine::general_purpose, Engine as _};

const PATCH: &str = "16.4.1";

// ── Summoner spell ID map (Data Dragon IDs → LCU spell IDs) ──────────────────
fn spell_name_to_id(name: &str) -> Option<u32> {
    match name.to_lowercase().as_str() {
        "flash"     | "summonerflash"      => Some(4),
        "ignite"    | "summonerdot"        => Some(14),
        "teleport"  | "summonerteleport"   => Some(12),
        "barrier"   | "summonerinspect"  |
        "summonerbarrier"                  => Some(21),
        "exhaust"   | "summonerexhaust"    => Some(3),
        "ghost"     | "summonerhaste"      => Some(6),
        "heal"      | "summonerheal"       => Some(7),
        "cleanse"   | "summonerraise"   |
        "summonerboost"                    => Some(1),
        "smite"     | "summonersmite"      => Some(11),
        "clarity"   | "summonermana"       => Some(13),
        _                                  => None,
    }
}

// ── Rune path / keystone ID maps ─────────────────────────────────────────────
fn rune_path_id(name: &str) -> Option<u32> {
    match name.to_lowercase().as_str() {
        "precision"    => Some(8000),
        "domination"   => Some(8100),
        "sorcery"      => Some(8200),
        "resolve"      => Some(8400),
        "inspiration"  => Some(8300),
        _ => None,
    }
}

// Map OP.GG rune names → LCU rune IDs
fn rune_name_to_id(name: &str) -> Option<u32> {
    match name.to_lowercase().replace(" ", "").replace("'", "").as_str() {
        // Precision keystones
        "presstheattack"             => Some(8005),
        "lethaltempolegacy" | "lethaltempo" => Some(8008),
        "fleetfootwork"              => Some(8021),
        "conqueror"                  => Some(8010),
        // Domination keystones
        "electrocute"                => Some(8112),
        "predator"                   => Some(8124),
        "darkharvest"                => Some(8128),
        "hailofblades"               => Some(9923),
        // Sorcery keystones
        "arcanecomet"                => Some(8229),
        "phasherush"                 => Some(8230),
        "summonaery" | "summonaerie" => Some(8214),
        // Resolve keystones
        "graspoftheundying"          => Some(8437),
        "aftershock"                 => Some(8439),
        "guardian"                   => Some(8465),
        // Inspiration keystones
        "glacialaugment"             => Some(8351),
        "unsealedspeelbook"  | "unsealedspellbook" => Some(8360),
        "firstatrike"                => Some(8369),
        // Precision row1
        "overheal"                   => Some(9101),
        "triumph"                    => Some(9111),
        "presenceofmind"             => Some(8009),
        // Precision row2
        "legendalacrity"             => Some(9104),
        "legendtenacity"             => Some(9105),
        "legendbloodline"            => Some(9103),
        // Precision row3
        "coupdegrace"                => Some(8014),
        "cutdown"                    => Some(8017),
        "laststand"                  => Some(8299),
        // Domination row1
        "cheapshot"                  => Some(8126),
        "tasteofblood"               => Some(8139),
        "suddenimpact"               => Some(8143),
        // Domination row2
        "zombieward"                 => Some(8136),
        "ghostporo"                  => Some(8120),
        "eyeballcollection"          => Some(8138),
        // Domination row3
        "relentlesshunter"           => Some(8105),
        "ingenieoushunter" | "ingeniushunter" => Some(8106),
        "ultimatehunter"             => Some(8135),
        "treasurehunter"             => Some(8134),
        // Sorcery row1
        "nullifyingorb"              => Some(8224),
        "manaflowband"               => Some(8226),
        "nimbus cloak" | "nimbuscloak" => Some(8275),
        // Sorcery row2
        "transcendence"              => Some(8210),
        "celerity"                   => Some(8234),
        "absolutefocus"              => Some(8233),
        // Sorcery row3
        "scorch"                     => Some(8237),
        "waterwalking"               => Some(8232),
        "gatheringstorm"             => Some(8236),
        // Resolve row1
        "demolish"                   => Some(8446),
        "fontoflife"                 => Some(8463),
        "shieldbasg" | "shieldbash"  => Some(8401),
        // Resolve row2
        "conditioning"               => Some(8429),
        "secondwind"                 => Some(8444),
        "boneplating"                => Some(8473),
        // Resolve row3
        "overgrowth"                 => Some(8451),
        "revitalize"                 => Some(8453),
        "unflinching"                => Some(8242),
        // Inspiration row1
        "hextech flashtraption" | "hextechflashtraption" => Some(8306),
        "magicalfootwear"            => Some(8304),
        "perfecttiming"              => Some(8313),
        // Inspiration row2
        "futuresmarket"              => Some(8321),
        "miniondematerializer"       => Some(8316),
        "biscodsfed" | "biscoitsofgoldfish" | "biscuitdelivery" => Some(8345),
        // Inspiration row3
        "cosmicinsight"              => Some(8347),
        "approachvelocity"           => Some(8410),
        "timewarpingtronic" | "timewarpedtonic" => Some(8352),
        _ => None,
    }
}

// ── Structures ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ChampSelectSession {
    pub in_progress:       bool,
    pub champion_name:     String,
    pub assigned_position: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub runes_imported:    bool,
    pub summoners_imported: bool,
    pub items_imported:    bool,
    pub rune_page_name:    Option<String>,
    pub primary_path:      Option<String>,
    pub summoner_spells:   Vec<String>,
    pub item_blocks:       Option<usize>,
    pub errors:            Vec<String>,
}

// ── LCU client helper ─────────────────────────────────────────────────────────

fn get_lockfile_path() -> PathBuf {
    PathBuf::from(r"C:\Riot Games\League of Legends\lockfile")
}

struct LcuClient {
    client:   Client,
    port:     String,
    auth:     String,
}

impl LcuClient {
    fn new() -> Option<Self> {
        let content = fs::read_to_string(get_lockfile_path()).ok()?;
        let parts: Vec<&str> = content.split(':').collect();
        if parts.len() < 4 { return None; }
        let port     = parts[2].to_string();
        let password = parts[3].to_string();
        let auth     = general_purpose::STANDARD.encode(format!("riot:{}", password));
        let client   = Client::builder().danger_accept_invalid_certs(true).build().ok()?;
        Some(LcuClient { client, port, auth })
    }

    async fn get(&self, path: &str) -> Option<Value> {
        self.client
            .get(&format!("https://127.0.0.1:{}{}", self.port, path))
            .header("Authorization", format!("Basic {}", self.auth))
            .send().await.ok()?
            .json().await.ok()
    }

    async fn put(&self, path: &str, body: &Value) -> Option<Value> {
        self.client
            .put(&format!("https://127.0.0.1:{}{}", self.port, path))
            .header("Authorization", format!("Basic {}", self.auth))
            .json(body).send().await.ok()?
            .json().await.ok()
    }

    async fn post(&self, path: &str, body: &Value) -> Option<Value> {
        self.client
            .post(&format!("https://127.0.0.1:{}{}", self.port, path))
            .header("Authorization", format!("Basic {}", self.auth))
            .json(body).send().await.ok()?
            .json().await.ok()
    }

    async fn patch(&self, path: &str, body: &Value) -> Option<Value> {
        self.client
            .patch(&format!("https://127.0.0.1:{}{}", self.port, path))
            .header("Authorization", format!("Basic {}", self.auth))
            .json(body).send().await.ok()?
            .json().await.ok()
    }
}

// ── OP.GG MCP — lol-champion-analysis ───────────────────────────────────────
//
// Il protocollo MCP Streamable HTTP (spec 2024-11-05 / 2025-03-26) richiede:
//   1. POST /mcp  { method: "initialize" }  →  ricevi mcp-session-id nell'header
//   2. POST /mcp  { method: "tools/call" }  →  con header mcp-session-id

async fn mcp_extract_text(text: &str) -> Option<String> {
    // Prova prima formato SSE ("data: {...}")
    for line in text.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                if parsed.get("error").is_some() { continue; }
                if let Some(content) = parsed["result"]["content"].as_array() {
                    for item in content {
                        if item["type"] == "text" {
                            if let Some(t) = item["text"].as_str() {
                                return Some(t.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    // Fallback JSON diretto
    if let Ok(parsed) = serde_json::from_str::<Value>(text) {
        if parsed.get("error").is_none() {
            if let Some(content) = parsed["result"]["content"].as_array() {
                for item in content {
                    if item["type"] == "text" {
                        if let Some(t) = item["text"].as_str() {
                            return Some(t.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

async fn opgg_get_champion_build(champion_name: &str, position: &str) -> Result<Value, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().map_err(|e| e.to_string())?;

    let pos = match position.to_uppercase().as_str() {
        "TOP"                      => "TOP",
        "JUNGLE"                   => "JUNGLE",
        "MIDDLE" | "MID"           => "MID",
        "BOTTOM" | "BOT" | "ADC"  => "ADC",
        "SUPPORT" | "UTILITY"      => "SUPPORT",
        _                          => "MID",
    };
    let champ_upper = champion_name.to_uppercase();

    const MCP_URL: &str = "https://mcp-api.op.gg/mcp";

    // ── Step 1: MCP initialize handshake → ottieni mcp-session-id ────────────
    let init_res = client.post(MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "rlp", "version": "1.0" }
            }
        }))
        .send().await.map_err(|e| format!("MCP init error: {}", e))?;

    let session_id = init_res
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let _ = init_res.text().await; // consuma body

    // ── Step 2: tools/call con nome corretto ────────────────────────────────
    let mut req = client.post(MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream");
    if let Some(ref sid) = session_id {
        req = req.header("mcp-session-id", sid.as_str());
    }

    let res = req.json(&json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "lol_get_champion_analysis",
                "arguments": {
                    "champion":   champ_upper,
                    "game_mode":  "ranked",
                    "position":   pos,
                    "lang":       "en_US",
                    "region":     "EUW"
                }
            }
        }))
        .send().await.map_err(|e| format!("HTTP error: {}", e))?;

    let text = res.text().await.map_err(|e| e.to_string())?;

    let text_content = mcp_extract_text(&text).await
        .ok_or_else(|| format!("Risposta MCP non valida. Raw: {}", &text[..text.len().min(800)]))?;

    parse_opgg_text_response(&text_content)
}

fn extract_numbers(s: &str) -> Vec<u64> {
    let mut nums = Vec::new();
    let mut i = 0;
    let bytes = s.as_bytes();
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() { i += 1; }
            if let Ok(n) = s[start..i].parse::<u64>() {
                nums.push(n);
            }
        } else {
            i += 1;
        }
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
        if c == '[' { depth += 1; }
        else if c == ']' {
            depth -= 1;
            if depth == 0 { end = i; break; }
        }
    }
    if end > 0 { Some(&rest[start..start + end + 1]) } else { None }
}

fn parse_opgg_text_response(text: &str) -> Result<Value, String> {
    let (primary_page_id, sub_page_id, primary_rune_ids, sub_rune_ids, stat_mod_ids) = {
        let runes_start = text.find("Runes(").ok_or("Runes( non trovato")?;
        let runes_section = &text[runes_start..];

        let until_first_bracket = &runes_section[6..runes_section.find('[').unwrap_or(50)];
        let scalar_nums = extract_numbers(until_first_bracket);
        let primary_page_id = scalar_nums.get(1).copied().unwrap_or(8000) as u32;

        let primary_ids: Vec<u32> = extract_array_content(runes_section, "Runes(")
            .map(|s| extract_numbers(s).iter().map(|&n| n as u32).collect())
            .unwrap_or_default();

        let after_first_array = runes_section.find(']').unwrap_or(0);
        let after_names_array = runes_section[after_first_array+1..].find(']')
            .map(|p| after_first_array + 1 + p + 1)
            .unwrap_or(after_first_array + 1);
        let sec_section = &runes_section[after_names_array..];
        let sec_nums = extract_numbers(&sec_section[..sec_section.find('[').unwrap_or(20)]);
        let sub_page_id = sec_nums.first().copied().unwrap_or(8100) as u32;

        let sec_ids: Vec<u32> = sec_section.find('[')
            .and_then(|p| {
                let s = &sec_section[p..];
                let end = s.find(']').map(|e| e + 1)?;
                Some(extract_numbers(&s[..end]).iter().map(|&n| n as u32).collect())
            })
            .unwrap_or_default();

        let after_sec_array = sec_section.find(']').unwrap_or(0);
        let after_sec_names = sec_section[after_sec_array+1..].find(']')
            .map(|p| after_sec_array + 1 + p + 1)
            .unwrap_or(after_sec_array + 1);
        let stat_section = &sec_section[after_sec_names..];
        let stat_ids: Vec<u32> = stat_section.find('[')
            .and_then(|p| {
                let s = &stat_section[p..];
                let end = s.find(']').map(|e| e + 1)?;
                Some(extract_numbers(&s[..end]).iter().map(|&n| n as u32).collect())
            })
            .unwrap_or_else(|| vec![5008, 5008, 5002]);

        (primary_page_id, sub_page_id, primary_ids, sec_ids, stat_ids)
    };

    let summoner_spells: Value = {
        let mut names: Vec<Value> = Vec::new();
        if let Some(pos) = text.find("SummonerSpells(") {
            let section = &text[pos..];
            let snippet = &section[..section.len().min(200)];
            let mut s = snippet;
            while let Some(q) = s.find('"') {
                s = &s[q+1..];
                if let Some(end) = s.find('"') {
                    let name = &s[..end];
                    if !name.is_empty() && !name.contains(',') {
                        names.push(json!(name));
                    }
                    s = &s[end+1..];
                }
            }
        }
        if names.len() >= 2 {
            json!(names)
        } else {
            json!(["Flash", "Ignite"])
        }
    };

    let starting_items = parse_item_section(text, "starter_items");
    let core_items     = parse_item_section(text, "CoreItems");
    let last_items     = parse_item_section(text, "last_items");

    Ok(json!({
        "data": {
            "runes": {
                "primary_page_id":   primary_page_id,
                "sub_page_id":       sub_page_id,
                "primary_rune_ids":  primary_rune_ids,
                "sub_rune_ids":      sub_rune_ids,
                "stat_mod_ids":      stat_mod_ids
            },
            "summoner_spells": summoner_spells,
            "starting_items":  starting_items,
            "core_items":      core_items,
            "last_items":      last_items
        }
    }))
}

fn parse_item_section(text: &str, section_name: &str) -> Value {
    if let Some(pos) = text.find(section_name) {
        let section = &text[pos..];
        if let Some(bracket) = section.find('[') {
            let s = &section[bracket..];
            if let Some(end) = s.find(']') {
                let ids: Vec<Value> = extract_numbers(&s[..end+1])
                    .iter().map(|&id| json!({"id": id})).collect();
                if !ids.is_empty() { return Value::Array(ids); }
            }
        }
    }
    Value::Array(vec![])
}




// ── Import: Rune ─────────────────────────────────────────────────────────────

async fn import_runes(
    lcu:          &LcuClient,
    champion:     &str,
    position:     &str,
    build:        &Value,
) -> Result<(String, String), String> {

    let rune_data = build.pointer("/data/runes")
        .or_else(|| build.get("runes"))
        .ok_or("Rune non trovate nella risposta OP.GG")?;

    let primary_id: u32 = rune_data["primary_page_id"]
        .as_u64().map(|n| n as u32)
        .or_else(|| rune_data["primaryPageId"].as_u64().map(|n| n as u32))
        .or_else(|| {
            rune_data["primary_page_id"].as_str()
                .or_else(|| rune_data["primaryPageId"].as_str())
                .and_then(rune_path_id)
        })
        .unwrap_or(8000);

    let sub_id: u32 = rune_data["sub_page_id"]
        .as_u64().map(|n| n as u32)
        .or_else(|| rune_data["subPageId"].as_u64().map(|n| n as u32))
        .or_else(|| {
            rune_data["sub_page_id"].as_str()
                .or_else(|| rune_data["subPageId"].as_str())
                .and_then(rune_path_id)
        })
        .unwrap_or(8100);

    let primary_path_name = rune_data["primary_page_id"]
        .as_str()
        .or_else(|| rune_data["primaryPageId"].as_str())
        .unwrap_or("Precision");

    let primary_ids: Vec<u32> = rune_data["primaryRuneIds"]
        .as_array()
        .or_else(|| rune_data["primary_rune_ids"].as_array())
        .map(|arr| arr.iter().filter_map(|v| {
            v.as_str().and_then(|s| rune_name_to_id(s))
            .or_else(|| v.as_u64().map(|n| n as u32))
        }).collect())
        .unwrap_or_default();

    let sub_ids: Vec<u32> = rune_data["subRuneIds"]
        .as_array()
        .or_else(|| rune_data["sub_rune_ids"].as_array())
        .map(|arr| arr.iter().filter_map(|v| {
            v.as_str().and_then(|s| rune_name_to_id(s))
            .or_else(|| v.as_u64().map(|n| n as u32))
        }).collect())
        .unwrap_or_default();

    let stat_ids: Vec<u32> = rune_data["statModIds"]
        .as_array()
        .or_else(|| rune_data["stat_mod_ids"].as_array())
        .map(|arr| arr.iter().filter_map(|v| {
            v.as_u64().map(|n| n as u32)
        }).collect())
        .unwrap_or_else(|| vec![5008, 5008, 5002]);

    let page_name = format!("RLP {} {}", champion, position);

    let pages: Vec<Value> = lcu.get("/lol-perks/v1/pages")
        .await
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();

    let editable_pages: Vec<&Value> = pages.iter()
        .filter(|p| p["isDeletable"].as_bool().unwrap_or(false))
        .collect();

    // Cancella pagina con stesso nome se esiste, altrimenti la prima editabile
    // (il LCU ha un limite di 20 pagine e il POST fallisce se sei al limite)
    let page_to_delete = editable_pages.iter()
        .find(|p| p["name"].as_str().unwrap_or("") == page_name)
        .or_else(|| editable_pages.first())
        .and_then(|p| p["id"].as_u64());

    if let Some(id) = page_to_delete {
        let _ = lcu.client
            .delete(&format!("https://127.0.0.1:{}/lol-perks/v1/pages/{}", lcu.port, id))
            .header("Authorization", format!("Basic {}", lcu.auth))
            .send().await;
    }

    let mut selected_perk_ids = Vec::new();
    selected_perk_ids.extend_from_slice(&primary_ids);
    selected_perk_ids.extend_from_slice(&sub_ids);
    selected_perk_ids.extend_from_slice(&stat_ids);

    let rune_page = json!({
        "name":               page_name,
        "primaryStyleId":     primary_id,
        "subStyleId":         sub_id,
        "selectedPerkIds":    selected_perk_ids,
        "current":            true
    });

    lcu.post("/lol-perks/v1/pages", &rune_page)
        .await
        .ok_or("Impossibile creare pagina rune via LCU")?;

    Ok((page_name, primary_path_name.to_string()))
}

// ── Import: Summoner Spells ───────────────────────────────────────────────────

async fn import_summoners(
    lcu:   &LcuClient,
    build: &Value,
) -> Result<Vec<String>, String> {

    // Cerca summoner_spells in data.summoner_spells o direttamente
    let spells_raw = build.pointer("/data/summoner_spells")
        .or_else(|| build.get("summoner_spells"))
        .and_then(|v| v.as_array())
        .ok_or("Summoner spells non trovate nel build")?;

    let spell_names: Vec<String> = spells_raw.iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();

    if spell_names.len() < 2 {
        return Err(format!("Meno di 2 summoner spells: {:?}", spells_raw));
    }

    let id1 = spell_name_to_id(&spell_names[0])
        .ok_or_else(|| format!("Spell '{}' non riconosciuta", spell_names[0]))?;
    let id2 = spell_name_to_id(&spell_names[1])
        .ok_or_else(|| format!("Spell '{}' non riconosciuta", spell_names[1]))?;

    // Il LCU richiede che il body sia inviato come raw HTTP (non tramite helper .patch)
    // perché la risposta può essere vuota (204) che causa errore nel .json()
    let resp = lcu.client
        .patch(&format!("https://127.0.0.1:{}/lol-champ-select/v1/session/my-selection", lcu.port))
        .header("Authorization", format!("Basic {}", lcu.auth))
        .header("Content-Type", "application/json")
        .json(&json!({ "spell1Id": id1, "spell2Id": id2 }))
        .send().await
        .map_err(|e| format!("LCU patch error: {}", e))?;

    let status = resp.status().as_u16();
    if status == 204 || status == 200 {
        Ok(spell_names)
    } else {
        let body = resp.text().await.unwrap_or_default();
        Err(format!("LCU status {}: {}", status, &body[..body.len().min(200)]))
    }
}

// ── Import: Item Set ──────────────────────────────────────────────────────────

async fn import_item_set(
    lcu:       &LcuClient,
    champion:  &str,
    position:  &str,
    build:     &Value,
    puuid:     &str,
) -> Result<usize, String> {

    let mut blocks: Vec<Value> = Vec::new();

    if let Some(starting) = build.pointer("/data/starting_items")
        .or_else(|| build.get("starting_items"))
        .and_then(|v| v.as_array())
    {
        let items: Vec<Value> = starting.iter()
            .filter_map(|v| v["id"].as_u64().or_else(|| v.as_u64()))
            .map(|id| json!({ "id": id.to_string(), "count": 1 }))
            .collect();
        if !items.is_empty() {
            blocks.push(json!({ "hideIfSummonerSpell": "", "items": items, "type": "Starting Items" }));
        }
    }

    if let Some(core) = build.pointer("/data/core_items")
        .or_else(|| build.get("core_items"))
        .and_then(|v| v.as_array())
    {
        let items: Vec<Value> = core.iter()
            .filter_map(|v| v["id"].as_u64().or_else(|| v.as_u64()))
            .map(|id| json!({ "id": id.to_string(), "count": 1 }))
            .collect();
        if !items.is_empty() {
            blocks.push(json!({ "hideIfSummonerSpell": "", "items": items, "type": "Core Build" }));
        }
    }

    if let Some(last) = build.pointer("/data/last_items")
        .or_else(|| build.get("last_items"))
        .and_then(|v| v.as_array())
    {
        let items: Vec<Value> = last.iter()
            .filter_map(|v| v["id"].as_u64().or_else(|| v.as_u64()))
            .map(|id| json!({ "id": id.to_string(), "count": 1 }))
            .collect();
        if !items.is_empty() {
            blocks.push(json!({ "hideIfSummonerSpell": "", "items": items, "type": "Situational / Late" }));
        }
    }

    if blocks.is_empty() {
        return Err("Nessun item trovato nella risposta OP.GG".to_string());
    }

    let block_count = blocks.len();
    let set_title   = format!("RLP {} {} (OP.GG)", champion, position);

    let item_set = json!({
        "title":         set_title,
        "associatedChampions": [],
        "associatedMaps": [11, 12],
        "blocks":        blocks,
        "map":           "any",
        "mode":          "any",
        "preferredItemSlots": [],
        "sortrank":      1,
        "startedFrom":   "blank",
        "type":          "custom",
        "uid":           format!("rlp-{}-{}", champion.to_lowercase(), position.to_lowercase())
    });

    let payload = json!({
        "accountId": puuid,
        "itemSets":  [item_set],
        "timestamp": 0
    });

    lcu.put("/lol-item-sets/v1/sets", &payload)
        .await
        .ok_or("Impossibile salvare item set via LCU")?;

    Ok(block_count)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_champ_select_session() -> Result<ChampSelectSession, String> {
    let lcu = LcuClient::new().ok_or("CLIENT_CLOSED")?;

    let session: Value = lcu.get("/lol-champ-select/v1/session")
        .await
        .ok_or("Nessuna champion select attiva")?;

    if session.get("errorCode").is_some() {
        return Ok(ChampSelectSession {
            in_progress:       false,
            champion_name:     String::new(),
            assigned_position: String::new(),
        });
    }

    let my_cell = session["localPlayerCellId"].as_i64().unwrap_or(-1);

    let my_slot = session["myTeam"]
        .as_array()
        .and_then(|team| team.iter().find(|p| p["cellId"].as_i64() == Some(my_cell)));

    let assigned_position = my_slot
        .and_then(|s| s["assignedPosition"].as_str())
        .unwrap_or("MIDDLE")
        .to_uppercase();

    // ── FIX: leggi championId o championPickIntent dal proprio slot
    let mut champ_id = my_slot
        .and_then(|s| s["championId"].as_u64().or_else(|| s["championPickIntent"].as_u64()))
        .unwrap_or(0);

    // ── FIX: fallback sulle actions per rilevare l'hover
    // Il LCU popola myTeam.championId solo dopo il lock-in;
    // durante l'hover il campione è visibile in actions[*][*].championId
    // dove actorCellId == localPlayerCellId e type == "pick"
    if champ_id == 0 {
        if let Some(phases) = session["actions"].as_array() {
            'outer: for phase in phases {
                if let Some(actions) = phase.as_array() {
                    for action in actions {
                        let is_my_action = action["actorCellId"].as_i64() == Some(my_cell);
                        let is_pick = action["type"].as_str() == Some("pick");
                        if is_my_action && is_pick {
                            if let Some(id) = action["championId"].as_u64() {
                                if id != 0 {
                                    champ_id = id;
                                    break 'outer;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if champ_id == 0 {
        return Ok(ChampSelectSession {
            in_progress:       true,
            champion_name:     String::new(),
            assigned_position: assigned_position,
        });
    }

    // Risolvi champion ID → nome tramite Data Dragon
    let ddragon_url = format!(
        "https://ddragon.leagueoflegends.com/cdn/{}/data/en_US/champion.json", PATCH
    );
    let http = Client::builder().danger_accept_invalid_certs(true).build().unwrap();
    let champs: Value = http.get(&ddragon_url).send().await
        .map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let champion_name = champs["data"]
        .as_object()
        .and_then(|map| {
            map.values().find(|c| c["key"].as_str().map(|k| k == champ_id.to_string()).unwrap_or(false))
        })
        .and_then(|c| c["id"].as_str())
        .unwrap_or("Unknown")
        .to_string();

    Ok(ChampSelectSession {
        in_progress: true,
        champion_name,
        assigned_position,
    })
}

#[tauri::command]
pub async fn debug_champ_select_slot() -> Result<Value, String> {
    let lcu = LcuClient::new().ok_or("CLIENT_CLOSED")?;
    let session: Value = lcu.get("/lol-champ-select/v1/session")
        .await.ok_or("Nessuna champion select attiva")?;
    if session.get("errorCode").is_some() {
        return Err("Non in champion select".to_string());
    }
    let my_cell = session["localPlayerCellId"].as_i64().unwrap_or(-1);
    let my_slot = session["myTeam"]
        .as_array()
        .and_then(|team| team.iter().find(|p| p["cellId"].as_i64() == Some(my_cell)))
        .cloned()
        .unwrap_or(json!({}));

    // Includi anche le actions del proprio slot per debug completo
    let my_actions: Vec<Value> = session["actions"]
        .as_array()
        .map(|phases| {
            phases.iter()
                .filter_map(|phase| phase.as_array())
                .flat_map(|actions| actions.iter().cloned())
                .filter(|action| action["actorCellId"].as_i64() == Some(my_cell))
                .collect()
        })
        .unwrap_or_default();

    Ok(json!({
        "my_slot": my_slot,
        "my_actions": my_actions,
        "localPlayerCellId": my_cell
    }))
}

#[tauri::command]
pub async fn auto_import_build(
    champion_name:     String,
    assigned_position: String,
) -> Result<ImportResult, String> {

    let mut result = ImportResult {
        runes_imported:    false,
        summoners_imported: false,
        items_imported:    false,
        rune_page_name:    None,
        primary_path:      None,
        summoner_spells:   Vec::new(),
        item_blocks:       None,
        errors:            Vec::new(),
    };

    let lcu = match LcuClient::new() {
        Some(c) => c,
        None    => {
            result.errors.push("Client LoL non disponibile".to_string());
            return Ok(result);
        }
    };

    let build = match opgg_get_champion_build(&champion_name, &assigned_position).await {
        Ok(b)  => b,
        Err(e) => {
            result.errors.push(format!("OP.GG fetch fallito: {}", e));
            return Ok(result);
        }
    };

    let summoner: Value = lcu.get("/lol-summoner/v1/current-summoner").await.unwrap_or(json!({}));
    let puuid = summoner["puuid"].as_str().unwrap_or("unknown").to_string();

    match import_runes(&lcu, &champion_name, &assigned_position, &build).await {
        Ok((name, path)) => {
            result.runes_imported = true;
            result.rune_page_name = Some(name);
            result.primary_path   = Some(path);
        }
        Err(e) => result.errors.push(format!("Rune: {}", e)),
    }

    match import_summoners(&lcu, &build).await {
        Ok(spells) => {
            result.summoners_imported = true;
            result.summoner_spells    = spells;
        }
        Err(_) => {
            result.summoners_imported = false;
        }
    }

    match import_item_set(&lcu, &champion_name, &assigned_position, &build, &puuid).await {
        Ok(blocks) => {
            result.items_imported = true;
            result.item_blocks    = Some(blocks);
        }
        Err(e) => result.errors.push(format!("Item set: {}", e)),
    }

    Ok(result)
}