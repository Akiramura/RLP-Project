#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{fs, path::PathBuf};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use base64::{engine::general_purpose, Engine as _};
use reqwest::Client;
use tokio::sync::OnceCell;
use std::collections::{HashSet, HashMap};
use tokio::sync::RwLock;

// ── Cargo.toml dependencies needed ──────────────────────────────────────────
// reqwest    = { version = "0.12", features = ["json"] }
// serde_json = "1"
// tokio      = { version = "1", features = ["full"] }
// chrono     = { version = "0.4", features = ["serde"] }
// base64     = "0.22"
// (Turso via HTTP puro — nessuna dipendenza nativa extra, solo reqwest)
// ────────────────────────────────────────────────────────────────────────────

mod champ_select;
use champ_select::{get_champ_select_session, auto_import_build, debug_champ_select_slot, apply_rune_page};

const OPGG_MCP_URL: &str = "https://mcp-api.op.gg/mcp";

fn riot_api_key() -> &'static str {
    env!("RIOT_API_KEY")
}

// ── Turso — solo per "recenti" (summoner index minimale) ─────────────────────
// Non salviamo matches né ranked_entries: solo l'essenziale per l'autocomplete.
const TURSO_URL:   &str = env!("TURSO_URL");
const TURSO_TOKEN: &str = env!("TURSO_TOKEN");

/// Esegue una SELECT su Turso e restituisce le righe come Vec<Vec<Value>>.
async fn turso_query(sql: &str, args: Vec<Value>) -> Result<Vec<Vec<Value>>, String> {
    let url = TURSO_URL.replace("libsql://", "https://") + "/v2/pipeline";
    let body = json!({
        "requests": [{
            "type": "execute",
            "stmt": {
                "sql": sql,
                "args": args.iter().map(|a| match a {
                    Value::Number(n) => json!({"type":"integer","value": n.to_string()}),
                    Value::String(s) => json!({"type":"text","value": s}),
                    _ => json!({"type":"null","value": null}),
                }).collect::<Vec<_>>()
            }
        }, {"type":"close"}]
    });
    let resp = Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {}", TURSO_TOKEN))
        .header("Content-Type", "application/json")
        .json(&body)
        .send().await.map_err(|e| format!("Turso HTTP: {}", e))?;
    let data: Value = resp.json().await.map_err(|e| format!("Turso JSON: {}", e))?;
    let rows_raw = data.pointer("/results/0/response/result/rows")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            let msg = data.pointer("/results/0/response/error/message")
                .and_then(|v| v.as_str()).unwrap_or("risposta vuota");
            format!("Turso query fallita: {}", msg)
        })?;
    let rows = rows_raw.iter().map(|row| {
        row.as_array().unwrap_or(&vec![]).iter().map(|cell| {
            match cell["type"].as_str() {
                Some("integer") => cell["value"].as_str()
                    .and_then(|s| s.parse::<i64>().ok()).map(|n| json!(n)).unwrap_or(Value::Null),
                Some("real")    => cell["value"].as_str()
                    .and_then(|s| s.parse::<f64>().ok()).map(|n| json!(n)).unwrap_or(Value::Null),
                Some("text")    => cell["value"].clone(),
                _               => Value::Null,
            }
        }).collect()
    }).collect();
    Ok(rows)
}

/// Esegue un DML (INSERT/UPDATE) su Turso — fire-and-forget.
async fn turso_execute(sql: &str, args: Vec<Value>) {
    let url = TURSO_URL.replace("libsql://", "https://") + "/v2/pipeline";
    let body = json!({
        "requests": [{
            "type": "execute",
            "stmt": {
                "sql": sql,
                "args": args.iter().map(|a| match a {
                    Value::Number(n) => json!({"type":"integer","value": n.to_string()}),
                    Value::String(s) => json!({"type":"text","value": s}),
                    _ => json!({"type":"null","value": null}),
                }).collect::<Vec<_>>()
            }
        }, {"type":"close"}]
    });
    if let Err(e) = Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {}", TURSO_TOKEN))
        .header("Content-Type", "application/json")
        .json(&body)
        .send().await
    {
        eprintln!("❌ turso_execute: {}", e);
    }
}

/// Salva solo i metadati essenziali per l'autocomplete dei recenti.
/// Non scrive matches né ranked_entries — fire-and-forget (spawn).
fn db_index_summoner(
    puuid:         String,
    game_name:     String,
    tag_line:      String,
    icon_id:       u64,
    level:         u64,
    solo_tier:     String,
    solo_rank:     String,
    solo_lp:       i64,
) {
    tokio::spawn(async move {
        turso_execute(
            "INSERT INTO summoner_cache
               (puuid, game_name, tag_line, profile, ranked_entries, matches,
                solo_tier, solo_rank, solo_lp, cached_at)
             VALUES (?1,?2,?3,?4,'[]','[]',?5,?6,?7,datetime('now'))
             ON CONFLICT(puuid) DO UPDATE SET
               game_name  = excluded.game_name,
               tag_line   = excluded.tag_line,
               profile    = excluded.profile,
               solo_tier  = excluded.solo_tier,
               solo_rank  = excluded.solo_rank,
               solo_lp    = excluded.solo_lp,
               cached_at  = datetime('now')",
            vec![
                json!(puuid),
                json!(game_name),
                json!(tag_line),
                json!(format!(r#"{{"profileIconId":{},"summonerLevel":{}}}"#, icon_id, level)),
                json!(solo_tier),
                json!(solo_rank),
                json!(solo_lp),
            ],
        ).await;
    });
}

// ── In-memory caches ─────────────────────────────────────────────────────────

/// Match detail cache — session-scoped, no TTL (match data non cambia mai).
static MATCH_CACHE: OnceCell<RwLock<HashMap<String, Value>>> = OnceCell::const_new();
async fn match_cache() -> &'static RwLock<HashMap<String, Value>> {
    MATCH_CACHE.get_or_init(|| async { RwLock::new(HashMap::new()) }).await
}

/// Match ID già identificati come pre-Season 2026: saltati senza chiamare Riot API.
static PRE2026_SKIP: OnceCell<RwLock<HashSet<String>>> = OnceCell::const_new();
async fn pre2026_skip() -> &'static RwLock<HashSet<String>> {
    PRE2026_SKIP.get_or_init(|| async { RwLock::new(HashSet::new()) }).await
}

/// Tier list cache (OP.GG MCP) — TTL 15 minuti.
static TIER_LIST_CACHE: OnceCell<RwLock<Option<(std::time::Instant, String)>>> = OnceCell::const_new();
async fn tier_list_cache() -> &'static RwLock<Option<(std::time::Instant, String)>> {
    TIER_LIST_CACHE.get_or_init(|| async { RwLock::new(None) }).await
}

/// Masteries cache — TTL 10 minuti.
static MASTERIES_CACHE: OnceCell<RwLock<HashMap<String, (std::time::Instant, Value)>>> = OnceCell::const_new();
async fn masteries_cache() -> &'static RwLock<HashMap<String, (std::time::Instant, Value)>> {
    MASTERIES_CACHE.get_or_init(|| async { RwLock::new(HashMap::new()) }).await
}

/// Summoner search cache — TTL 10 minuti.
static SUMMONER_CACHE: OnceCell<RwLock<HashMap<String, (std::time::Instant, Value)>>> = OnceCell::const_new();
async fn summoner_cache() -> &'static RwLock<HashMap<String, (std::time::Instant, Value)>> {
    SUMMONER_CACHE.get_or_init(|| async { RwLock::new(HashMap::new()) }).await
}

/// Live game cache — TTL 25s (il frontend polla ogni 30s).
/// Key: puuid del giocatore osservato (vuota = proprio profilo).
static LIVE_GAME_CACHE: OnceCell<RwLock<HashMap<String, (std::time::Instant, Value)>>> = OnceCell::const_new();
async fn live_game_cache() -> &'static RwLock<HashMap<String, (std::time::Instant, Value)>> {
    LIVE_GAME_CACHE.get_or_init(|| async { RwLock::new(HashMap::new()) }).await
}

/// Ranked entry cache per il live game — TTL 5 minuti per puuid.
static RANKED_CACHE: OnceCell<RwLock<HashMap<String, (std::time::Instant, (String, String, i64))>>> = OnceCell::const_new();
async fn ranked_cache() -> &'static RwLock<HashMap<String, (std::time::Instant, (String, String, i64))>> {
    RANKED_CACHE.get_or_init(|| async { RwLock::new(HashMap::new()) }).await
}

// ── Season filter ─────────────────────────────────────────────────────────────

const SEASON_2026_START_MS:   u64 = 1_736_294_400_000; // 2026-01-08 00:00:00 UTC in ms
const SEASON_2026_START_SECS: u64 = 1_736_294_400;     // same in seconds

fn filter_season_matches(matches: Value) -> Value {
    match matches.as_array() {
        None => matches,
        Some(arr) => {
            let filtered: Vec<Value> = arr.iter().filter(|m| {
                let gc = m["info"]["gameCreation"].as_u64()
                    .or_else(|| m["gameCreation"].as_u64())
                    .unwrap_or(u64::MAX);
                if gc < SEASON_2026_START_MS { return false; }
                let queue_id = m["info"]["queueId"].as_u64()
                    .or_else(|| m["queueId"].as_u64())
                    .unwrap_or(1);
                queue_id != 0
            }).cloned().collect();
            json!(filtered)
        }
    }
}

// ── LCU helpers ───────────────────────────────────────────────────────────────

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
                eprintln!("[LCU] lockfile trovato: {:?}", path);
                return Some(path);
            }
        }
    }
    eprintln!("[LCU] lockfile non trovato su nessun drive (C:-Z:)");
    None
}

fn get_cache_path(handle: &AppHandle) -> PathBuf {
    handle.path().app_cache_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("cache.json")
}

// ── Riot API helpers ──────────────────────────────────────────────────────────

/// Percent-encodes un path segment RFC-3986.
fn encode_path(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
        | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        b' '  => "%20".to_string(),
        b     => format!("%{:02X}", b),
    }).collect::<Vec<_>>().join("")
}

async fn fetch_puuid(game_name: &str, tag_line: &str, client: &Client) -> Option<String> {
    let url = format!(
        "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{}/{}",
        encode_path(game_name), encode_path(tag_line)
    );
    let res = match client.get(&url).header("X-Riot-Token", riot_api_key()).send().await {
        Ok(r)  => r,
        Err(e) => { eprintln!("❌ fetch_puuid: {}", e); return None; }
    };
    if res.status().as_u16() != 200 { return None; }
    let data: Value = res.json().await.ok()?;
    data["puuid"].as_str().map(|s| s.to_string())
}

async fn fetch_match_ids_since(puuid: &str, start: u32, count: u32, start_time: Option<u64>, client: &Client) -> Vec<String> {
    let mut url = format!(
        "https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/{}/ids?start={}&count={}",
        puuid, start, count
    );
    if let Some(ts) = start_time {
        url.push_str(&format!("&startTime={}", ts));
    }
    for attempt in 0..3u32 {
        match client.get(&url).header("X-Riot-Token", riot_api_key()).send().await {
            Ok(res) => {
                if res.status().as_u16() == 429 {
                    tokio::time::sleep(std::time::Duration::from_millis(2000 * (attempt + 1) as u64)).await;
                    continue;
                }
                return res.json::<Vec<String>>().await.unwrap_or_default();
            }
            Err(_) => return vec![],
        }
    }
    vec![]
}

async fn fetch_match_detail(match_id: &str, client: &Client) -> Value {
    // Fast-path: già identificato come pre-2026 in questa sessione
    {
        let skip = pre2026_skip().await.read().await;
        if skip.contains(match_id) { return json!({}); }
    }

    // In-memory cache (session)
    {
        let cache = match_cache().await.read().await;
        if let Some(cached) = cache.get(match_id) {
            let gc = cached["info"]["gameCreation"].as_u64().unwrap_or(u64::MAX);
            if gc < SEASON_2026_START_MS {
                drop(cache);
                pre2026_skip().await.write().await.insert(match_id.to_string());
                return json!({});
            }
            eprintln!("✓ match cache hit: {}", match_id);
            return cached.clone();
        }
    }

    let url = format!("https://europe.api.riotgames.com/lol/match/v5/matches/{}", match_id);
    for attempt in 0..3u32 {
        match client.get(&url).header("X-Riot-Token", riot_api_key()).send().await {
            Ok(res) => {
                if res.status().as_u16() == 429 {
                    tokio::time::sleep(std::time::Duration::from_millis(2000 * (attempt + 1) as u64)).await;
                    continue;
                }
                let data = res.json::<Value>().await.unwrap_or(json!({}));
                if data.get("metadata").is_some() {
                    let gc = data["info"]["gameCreation"].as_u64().unwrap_or(u64::MAX);
                    if gc < SEASON_2026_START_MS {
                        pre2026_skip().await.write().await.insert(match_id.to_string());
                        return json!({});
                    }
                    match_cache().await.write().await.insert(match_id.to_string(), data.clone());
                }
                return data;
            }
            Err(_) => return json!({}),
        }
    }
    json!({})
}

/// Recupera ranked SoloQ (fallback Flex) per un puuid via League-V4.
/// Cache in-memory TTL 5 minuti — evita chiamate ripetute per lo stesso player.
async fn fetch_ranked_entry(puuid: String, client: Client) -> (String, String, i64) {
    if puuid.is_empty() { return (String::new(), String::new(), 0); }
    // Cache check
    {
        let cache = ranked_cache().await.read().await;
        if let Some((ts, entry)) = cache.get(&puuid) {
            if ts.elapsed() < std::time::Duration::from_secs(300) {
                return entry.clone();
            }
        }
    }
    let url = format!("https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/{}", puuid);
    let entries: Vec<Value> = match client.get(&url)
        .header("X-Riot-Token", riot_api_key())
        .timeout(std::time::Duration::from_secs(10))
        .send().await
    {
        Ok(r) if r.status().as_u16() == 200 => r.json().await.unwrap_or_default(),
        _ => return (String::new(), String::new(), 0), // non cachare fallimenti
    };
    let result = {
        let mut found = (String::new(), String::new(), 0i64);
        'outer: for queue in &["RANKED_SOLO_5x5", "RANKED_FLEX_SR"] {
            if let Some(e) = entries.iter().find(|e| e["queueType"].as_str() == Some(queue)) {
                let tier = e["tier"].as_str().unwrap_or("").to_uppercase();
                let rank = e["rank"].as_str().unwrap_or("").to_uppercase();
                let lp   = e["leaguePoints"].as_i64().unwrap_or(0);
                if !tier.is_empty() && tier != "NONE" {
                    found = (tier, rank, lp);
                    break 'outer;
                }
            }
        }
        found
    };
    // Salva in cache SOLO se abbiamo un tier reale (non Unranked genuino vs errore)
    // Per gli Unranked genuini (entries vuoto ma 200 OK) salviamo comunque con TTL breve
    if !result.0.is_empty() {
        ranked_cache().await.write().await
            .insert(puuid, (std::time::Instant::now(), result.clone()));
    }
    result
}

/// Recupera dati smart per i badge live: summoner_level + mastery top-1.
/// Solo 2 chiamate parallele per player.
async fn fetch_smart_data_live(puuid: String, client: Client) -> Option<Value> {
    if puuid.is_empty() { return None; }
    let c1 = client.clone();
    let c2 = client.clone();
    let p1 = puuid.clone();
    let p2 = puuid.clone();

    let (summoner_res, masteries_res) = tokio::join!(
        async move {
            let url = format!("https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{}", p1);
            let r = c1.get(&url).header("X-Riot-Token", riot_api_key()).send().await.ok()?;
            if !r.status().is_success() { return None; }
            r.json::<Value>().await.ok()
        },
        async move {
            let url = format!(
                "https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/{}/top?count=1",
                p2
            );
            let r = c2.get(&url).header("X-Riot-Token", riot_api_key()).send().await.ok()?;
            if !r.status().is_success() { return None; }
            r.json::<Value>().await.ok()
        }
    );

    let summoner_level   = summoner_res.as_ref().and_then(|s| s["summonerLevel"].as_u64());
    let main_champion_id = masteries_res.as_ref()
        .and_then(|v| v.as_array()).and_then(|a| a.first())
        .and_then(|m| m["championId"].as_u64());

    Some(json!({
        "summoner_level":      summoner_level,
        "main_champion":       null,
        "main_champion_id":    main_champion_id,
        "main_role":           null,
        "total_games":         0,
        "games_on_main_champ": 0,
    }))
}

/// Recupera profilo via Riot API (usato quando LCU non è disponibile).
async fn fetch_profile_from_riot_api(game_name: &str, tag_line: &str, client: &Client) -> Option<Value> {
    eprintln!("[RLP] fetch Riot API per {}", game_name);
    let puuid = fetch_puuid(game_name, tag_line, client).await?;

    let ranked_text = client
        .get(&format!("https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/{}", puuid))
        .header("X-Riot-Token", riot_api_key())
        .send().await.ok()?
        .text().await.unwrap_or_default();
    let ranked_entries: Value = serde_json::from_str(&ranked_text).unwrap_or(json!([]));

    let summoner: Value = client
        .get(&format!("https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{}", puuid))
        .header("X-Riot-Token", riot_api_key())
        .send().await.ok()?
        .json().await.unwrap_or(json!({}));

    let match_ids = fetch_match_ids_since(&puuid, 0, 10, Some(SEASON_2026_START_SECS), client).await;
    let mut match_details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        let detail = fetch_match_detail(id, client).await;
        if detail.get("metadata").is_none() { continue; }
        let queue_id = detail["info"]["queueId"].as_u64().unwrap_or(1);
        if queue_id != 0 { match_details.push(detail); }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    let profile = json!({
        "gameName":       game_name,
        "tagLine":        tag_line,
        "summonerLevel":  summoner["summonerLevel"],
        "profileIconId":  summoner["profileIconId"],
        "xpSinceLastLevel":  0,
        "xpUntilNextLevel":  1,
    });

    let normalized_entries: Vec<Value> = ranked_entries.as_array().unwrap_or(&vec![])
        .iter().map(|e| {
            let mut entry = e.clone();
            if entry["division"].is_null() {
                let rank_val = e["rank"].clone();
                entry["division"] = rank_val;
            }
            entry
        }).collect();
    let ranked_json = json!(normalized_entries);
    let queues: Vec<Value> = normalized_entries.clone();

    eprintln!("[RLP] Riot API fetch completato per {} ({} match)", game_name, match_details.len());

    Some(json!({
        "puuid":          puuid,
        "profile":        profile,
        "ranked":         { "queues": queues },
        "ranked_entries": ranked_json,
        "matches":        match_details,
        "last_update":    chrono::Utc::now().to_rfc3339()
    }))
}

/// Fallback quando LCU non è raggiungibile:
/// 1. Riot API pubblica (dati freschi)
/// 2. Cache locale JSON (ultimo fallback)
async fn offline_fallback(cached_data: &Option<Value>) -> Result<Value, String> {
    if let Some(cache) = cached_data {
        let game_name = cache["profile"]["gameName"].as_str()
            .or_else(|| cache["profile"]["game_name"].as_str())
            .unwrap_or("");
        let tag_line = cache["profile"]["tagLine"].as_str()
            .or_else(|| cache["profile"]["tag_line"].as_str())
            .unwrap_or("");

        if !game_name.is_empty() && !tag_line.is_empty() {
            let client = Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(std::time::Duration::from_secs(15))
                .build().unwrap();

            if let Some(fresh) = fetch_profile_from_riot_api(game_name, tag_line, &client).await {
                eprintln!("[RLP] Dati freschi da Riot API (client chiuso).");
                return Ok(fresh);
            }
            eprintln!("[RLP] Riot API non raggiungibile, uso cache locale.");
        }
    }

    match cached_data {
        Some(cache) => {
            eprintln!("[RLP] Uso cache locale come fallback.");
            Ok(cache.clone())
        }
        None => Err("CLIENT_CLOSED".into()),
    }
}

// ── Live Game helpers ─────────────────────────────────────────────────────────

fn spell_id_to_ddragon(id: u64) -> &'static str {
    match id {
        4  => "SummonerFlash",    14 => "SummonerDot",
        12 => "SummonerTeleport", 21 => "SummonerBarrier",
        3  => "SummonerExhaust",  6  => "SummonerHaste",
        7  => "SummonerHeal",     1  => "SummonerBoost",
        11 => "SummonerSmite",    13 => "SummonerMana",
        32 => "SummonerSnowball", _  => "SummonerFlash",
    }
}

/// Chiama la Live Client Data API locale (porta 2999).
/// Disponibile ONLY quando sei personalmente in partita.
async fn fetch_live_client_data(client: &Client) -> Option<Value> {
    let res = client
        .get("https://127.0.0.1:2999/liveclientdata/allgamedata")
        .send().await.ok()?;
    if !res.status().is_success() { return None; }
    let data: Value = res.json().await.ok()?;
    if data["allPlayers"].as_array().is_none() { return None; }
    Some(data)
}

/// Normalizza la risposta LCD nel formato interno.
fn build_live_game_from_lcd(lcd: &Value, my_summoner_name: &str) -> Value {
    let game_data  = &lcd["gameData"];
    let queue_type = match game_data["gameMode"].as_str().unwrap_or("") {
        "CLASSIC"      => "Normal/Ranked",
        "ARAM"         => "ARAM",
        "URF"          => "URF",
        "ARURF"        => "ARURF",
        "ONEFORALL"    => "One for All",
        "NEXUSBLITZ"   => "Nexus Blitz",
        "ULTBOOK"      => "Ultimate Spellbook",
        "CHERRY"       => "Arena",
        "TUTORIAL"     => "Tutorial",
        "PRACTICETOOL" => "Practice Tool",
        other          => other,
    }.to_string();

    let game_length = game_data["gameTime"].as_f64().unwrap_or(0.0) as u64;
    let empty = vec![];
    let all_players = lcd["allPlayers"].as_array().unwrap_or(&empty);

    fn map_spell(s: &str) -> &str {
        match s {
            "SummonerFlash"    => "SummonerFlash",
            "SummonerDot"      => "SummonerDot",
            "SummonerTeleport" => "SummonerTeleport",
            "SummonerBarrier"  => "SummonerBarrier",
            "SummonerExhaust"  => "SummonerExhaust",
            "SummonerHaste"    => "SummonerHaste",
            "SummonerHeal"     => "SummonerHeal",
            "SummonerBoost"    => "SummonerBoost",
            "SummonerSmite"    => "SummonerSmite",
            "SummonerMana"     => "SummonerMana",
            "SummonerSnowball" => "SummonerSnowball",
            other              => other,
        }
    }

    let players: Vec<Value> = all_players.iter().map(|p| {
        let name = p["summonerName"].as_str().unwrap_or("").to_string();
        let champ = p["championName"].as_str().unwrap_or("").to_string();
        let team_str = p["team"].as_str().unwrap_or("ORDER");
        let is_me = name.eq_ignore_ascii_case(my_summoner_name)
            || name.eq_ignore_ascii_case(my_summoner_name.split('#').next().unwrap_or(""));
        let spell1 = p["summonerSpells"]["summonerSpellOne"]["displayName"].as_str().unwrap_or("SummonerFlash");
        let spell2 = p["summonerSpells"]["summonerSpellTwo"]["displayName"].as_str().unwrap_or("SummonerFlash");
        json!({
            "summoner_name":     name,
            "puuid":             "",
            "champion_id":       0,
            "champion_name":     champ,
            "profile_icon_id":   0,
            "team":              team_str,
            "spell1":            map_spell(spell1),
            "spell2":            map_spell(spell2),
            "tier":              "",
            "rank":              "",
            "lp":                0,
            "is_me":             is_me,
            "summoner_level":    null,
            "main_champion":     null,
            "main_champion_id":  null,
            "main_role":         null,
            "total_games":       0,
            "games_on_champion": 0,
        })
    }).collect();

    let bans = lcd["teamData"]["bannedChampions"].as_array()
        .unwrap_or(&empty).iter()
        .map(|b| json!({
            "champion_id": b["championId"].as_i64().unwrap_or(-1),
            "team":        "ORDER",
            "pick_turn":   b["pickTurn"].as_u64().unwrap_or(0),
        })).collect::<Vec<_>>();

    json!({
        "in_game":          true,
        "game_time":        game_length,
        "game_start_time":  0,
        "queue_type":       queue_type,
        "game_id":          0,
        "banned_champions": bans,
        "players":          players,
        "duo_pairs":        [],
        "_source":          "lcd",
    })
}

/// Chiama Spectator-V5 per un puuid.
async fn fetch_spectator(puuid: &str, client: &Client) -> Option<Value> {
    let url = format!(
        "https://euw1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/{}",
        puuid
    );
    let res = match client.get(&url)
        .header("X-Riot-Token", riot_api_key())
        .timeout(std::time::Duration::from_secs(8))
        .send().await
    {
        Ok(r)  => r,
        Err(e) => { eprintln!("[Spectator] Errore: {}", e); return None; }
    };
    let code = res.status().as_u16();
    eprintln!("[Spectator] HTTP {} per puuid={:.20}", code, puuid);
    if code != 200 { return None; }
    let data: Value = res.json().await.ok()?;
    if data.get("status").is_some() { return None; }
    Some(data)
}

/// Normalizza la risposta Spectator V5 nel formato interno.
/// Fetcha ranked + smart data (summoner_level + mastery) in parallelo per ogni player.
async fn build_live_game_response(raw: &Value, my_puuid: &str, client: &Client) -> Value {
    let queue_id   = raw["gameQueueConfigId"].as_u64().unwrap_or(0);
    let queue_type = match queue_id {
        420  => "Ranked Solo/Duo", 440 => "Ranked Flex",
        400  => "Normal Draft",    430 => "Normal Blind",
        450  => "ARAM",
        900  | 1900 => "URF",
        1010 | 1012 => "ARURF",
        1020 => "One for All",
        1700 | 1710 => "Arena",
        1400 => "Ultimate Spellbook",
        700  | 1300 => "Nexus Blitz",
        600  => "Clash",
        480  => "Swiftplay",
        490  => "Normal Quickplay",
        _    => "Other",
    }.to_string();

    let game_length     = raw["gameLength"].as_u64().unwrap_or(0);
    let game_start_time = raw["gameStartTime"].as_i64().unwrap_or(0);
    let empty_arr = vec![];

    let banned: Vec<Value> = raw["bannedChampions"].as_array().unwrap_or(&empty_arr)
        .iter().map(|b| json!({
            "champion_id": b["championId"].as_i64().unwrap_or(-1),
            "team":        if b["teamId"].as_u64().unwrap_or(100) == 100 { "ORDER" } else { "CHAOS" },
            "pick_turn":   b["pickTurn"].as_u64().unwrap_or(0),
        })).collect();

    let participants = raw["participants"].as_array().unwrap_or(&empty_arr);
    let puuids: Vec<String> = participants.iter()
        .map(|p| p["puuid"].as_str().unwrap_or("").to_string())
        .collect();

    // Ranked + smart data: tutti in parallelo (2 API call per player)
    let rank_handles: Vec<_> = puuids.iter().map(|puuid| {
        let p = puuid.clone();
        let c = client.clone();
        tokio::spawn(async move { fetch_ranked_entry(p, c).await })
    }).collect();

    let smart_handles: Vec<_> = puuids.iter().map(|puuid| {
        let p = puuid.clone();
        let c = client.clone();
        tokio::spawn(async move {
            if p.is_empty() { return (p, None); }
            let sd = fetch_smart_data_live(p.clone(), c).await;
            (p, sd)
        })
    }).collect();

    let mut ranks: Vec<(String, String, i64)> = Vec::new();
    for h in rank_handles { ranks.push(h.await.unwrap_or_default()); }

    let mut smart_map: HashMap<String, Value> = HashMap::new();
    for h in smart_handles {
        if let Ok((puuid, Some(sd))) = h.await { smart_map.insert(puuid, sd); }
    }

    let players: Vec<Value> = participants.iter()
        .zip(ranks.iter())
        .map(|(p, (tier, rank, lp))| {
            let puuid_p      = p["puuid"].as_str().unwrap_or("");
            let champ_id     = p["championId"].as_u64().unwrap_or(0);
            let team_id      = p["teamId"].as_u64().unwrap_or(100);
            let profile_icon = p["profileIconId"].as_u64().unwrap_or(0);
            let riot_id      = p["riotId"].as_str().unwrap_or("");
            let name         = if !riot_id.is_empty() { riot_id.to_string() }
                               else { p["summonerName"].as_str().unwrap_or("").to_string() };
            let is_me        = !my_puuid.is_empty() && puuid_p == my_puuid;
            let smart        = smart_map.get(puuid_p);

            let summoner_level   = smart.and_then(|s| s["summoner_level"].as_u64());
            let main_champion_id = smart.and_then(|s| s["main_champion_id"].as_u64());
            let main_champion    = smart.and_then(|s| s["main_champion"].as_str().map(|v| v.to_string()));
            let main_role        = smart.and_then(|s| s["main_role"].as_str().map(|v| v.to_string()));
            let total_games      = smart.and_then(|s| s["total_games"].as_u64()).unwrap_or(0);
            let games_on_champion = smart.and_then(|s| s["games_on_main_champ"].as_u64()).unwrap_or(0);

            json!({
                "summoner_name":     name,
                "puuid":             puuid_p,
                "champion_id":       champ_id,
                "champion_name":     "",
                "profile_icon_id":   profile_icon,
                "team":              if team_id == 100 { "ORDER" } else { "CHAOS" },
                "spell1":            spell_id_to_ddragon(p["spell1Id"].as_u64().unwrap_or(0)),
                "spell2":            spell_id_to_ddragon(p["spell2Id"].as_u64().unwrap_or(0)),
                "tier":              tier,
                "rank":              rank,
                "lp":                lp,
                "is_me":             is_me,
                "summoner_level":    summoner_level,
                "main_champion":     main_champion,
                "main_champion_id":  main_champion_id,
                "main_role":         main_role,
                "total_games":       total_games,
                "games_on_champion": games_on_champion,
            })
        })
        .collect();

    json!({
        "in_game":          true,
        "game_time":        game_length,
        "game_start_time":  game_start_time,
        "queue_type":       queue_type,
        "game_id":          raw["gameId"],
        "banned_champions": banned,
        "players":          players,
        "duo_pairs":        [],
    })
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Carica il profilo del giocatore loggato via LCU + Riot API.
/// Fallback: Riot API diretta → cache locale.
#[tauri::command]
async fn get_profiles(handle: AppHandle) -> Result<Value, String> {
    let cache_p    = get_cache_path(&handle);
    let cached_data: Option<Value> = fs::read_to_string(&cache_p).ok()
        .and_then(|s| serde_json::from_str(&s).ok());

    let lock_path = match get_lockfile_path() {
        Some(p) => p,
        None    => {
            eprintln!("[RLP] Client chiuso (no lockfile), offline fallback.");
            return offline_fallback(&cached_data).await;
        }
    };

    if !lock_path.exists() {
        return offline_fallback(&cached_data).await;
    }

    let content  = fs::read_to_string(&lock_path).map_err(|_| "Errore lockfile")?;
    let parts: Vec<&str> = content.split(':').collect();
    let port     = parts[2];
    let password = parts[3];
    let auth     = general_purpose::STANDARD.encode(format!("riot:{}", password));
    let client   = Client::builder().danger_accept_invalid_certs(true).build().unwrap();

    let lcu_resp = match client
        .get(&format!("https://127.0.0.1:{}/lol-summoner/v1/current-summoner", port))
        .header("Authorization", format!("Basic {}", auth))
        .send().await
    {
        Ok(r) => r,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("connection refused") || msg.contains("actively refused")
                || msg.contains("tcp connect") || msg.contains("os error 10061")
                || msg.contains("os error 111")
            {
                eprintln!("[RLP] LCU non raggiungibile, offline fallback.");
                return offline_fallback(&cached_data).await;
            }
            return Err(msg);
        }
    };

    let current_profile: Value = lcu_resp.json().await.map_err(|_| "Errore JSON profilo")?;
    let game_name = current_profile["gameName"].as_str().unwrap_or("").to_string();
    let tag_line  = current_profile["tagLine"].as_str().unwrap_or("").to_string();

    if game_name.is_empty() || game_name.contains("-match-") || game_name.starts_with("teambuilder-") {
        eprintln!("[RLP] gameName transitorio: '{}', uso cache", game_name);
        return cached_data.ok_or("CLIENT_NOT_READY".into());
    }
    if tag_line.is_empty() {
        return Err("Impossibile leggere tagLine dal client".into());
    }

    let puuid = fetch_puuid(&game_name, &tag_line, &client).await
        .ok_or("Impossibile recuperare PUUID da Riot API")?;

    // Cache locale valida (< 30 min, stesso puuid, match con oggetti)
    if let Some(cache) = &cached_data {
        let cached_puuid = cache["puuid"].as_str().unwrap_or("");
        let has_match_objects = cache["matches"].as_array()
            .and_then(|a| a.first()).map(|f| f.is_object()).unwrap_or(false);
        let is_fresh = cache["last_update"].as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| (chrono::Utc::now() - dt.with_timezone(&chrono::Utc)).num_minutes() < 30)
            .unwrap_or(false);

        if cached_puuid == puuid && !puuid.is_empty() && has_match_objects && is_fresh {
            if let Some(matches) = cache.get("matches").cloned() {
                let filtered = filter_season_matches(matches);
                if !filtered.as_array().map(|a| a.is_empty()).unwrap_or(true) {
                    let mut c = cache.clone();
                    c["matches"] = filtered;
                    eprintln!("[RLP] Cache locale valida (< 30 min).");
                    return Ok(c);
                }
            } else {
                return Ok(cache.clone());
            }
        }
    }

    let ranked: Value = client
        .get(&format!("https://127.0.0.1:{}/lol-ranked/v1/current-ranked-stats", port))
        .header("Authorization", format!("Basic {}", auth))
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|_| "Errore JSON Rank")?;

    let match_ids = fetch_match_ids_since(&puuid, 0, 20, Some(SEASON_2026_START_SECS), &client).await;
    let mut match_details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        let detail = fetch_match_detail(id, &client).await;
        if detail.get("metadata").is_none() { continue; }
        let queue_id = detail["info"]["queueId"].as_u64().unwrap_or(1);
        if queue_id != 0 { match_details.push(detail); }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    let final_data = json!({
        "puuid":        puuid,
        "profile":      current_profile,
        "ranked":       ranked,
        "matches":      match_details,
        "last_update":  chrono::Utc::now().to_rfc3339()
    });

    // Indicizza il giocatore loggato nei recenti (fire-and-forget)
    {
        let icon_id   = final_data["profile"]["profileIconId"].as_u64().unwrap_or(0);
        let level     = final_data["profile"]["summonerLevel"].as_u64().unwrap_or(0);
        let queues    = final_data["ranked"]["queues"].as_array().cloned().unwrap_or_default();
        let solo      = queues.iter().find(|e| e["queueType"].as_str() == Some("RANKED_SOLO_5x5"));
        let solo_tier = solo.and_then(|e| e["tier"].as_str()).unwrap_or("").to_string();
        let solo_rank = solo.and_then(|e| e["rank"].as_str()
            .or_else(|| e["division"].as_str())).unwrap_or("").to_string();
        let solo_lp   = solo.and_then(|e| e["leaguePoints"].as_i64()).unwrap_or(0);
        db_index_summoner(
            puuid.clone(), game_name.clone(), tag_line.clone(),
            icon_id, level, solo_tier, solo_rank, solo_lp,
        );
    }

    let _ = fs::write(cache_p, final_data.to_string());
    Ok(final_data)
}

/// Carica altri match per il summoner (paginazione).
#[tauri::command]
async fn get_more_matches(puuid: String, start: u32) -> Result<Value, String> {
    let client = Client::builder().danger_accept_invalid_certs(true).build().unwrap();
    let match_ids = fetch_match_ids_since(&puuid, start, 10, Some(SEASON_2026_START_SECS), &client).await;
    let mut details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        let detail = fetch_match_detail(id, &client).await;
        if detail.get("metadata").is_none() { continue; }
        let queue_id = detail["info"]["queueId"].as_u64().unwrap_or(1);
        if queue_id == 0 { continue; }
        let gc = detail["info"]["gameCreation"].as_u64().unwrap_or(u64::MAX);
        if gc < SEASON_2026_START_MS { continue; }
        details.push(detail);
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    Ok(json!(details))
}

/// Cerca un summoner per nome#tag via Riot API.
/// Cache in-memory TTL 10 minuti.
#[tauri::command]
async fn search_summoner(game_name: String, tag_line: String) -> Result<Value, String> {
    let client = Client::builder().danger_accept_invalid_certs(true).build().unwrap();

    let puuid = fetch_puuid(&game_name, &tag_line, &client).await
        .ok_or("Summoner non trovato. Controlla nome e tag.")?;

    // Cache check (TTL 10 min)
    {
        let cache = summoner_cache().await.read().await;
        if let Some((ts, cached)) = cache.get(&puuid) {
            if ts.elapsed() < std::time::Duration::from_secs(600) {
                eprintln!("[search] cache HIT puuid={:.20}", puuid);
                return Ok(cached.clone());
            }
        }
    }

    let account: Value = client
        .get(&format!("https://europe.api.riotgames.com/riot/account/v1/accounts/by-puuid/{}", puuid))
        .header("X-Riot-Token", riot_api_key())
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|_| "Errore JSON account")?;

    let ranked_text = client
        .get(&format!("https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/{}", puuid))
        .header("X-Riot-Token", riot_api_key())
        .send().await.map_err(|e| e.to_string())?
        .text().await.unwrap_or_default();
    let ranked_entries: Value = serde_json::from_str(&ranked_text).unwrap_or(json!([]));

    let summoner: Value = client
        .get(&format!("https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{}", puuid))
        .header("X-Riot-Token", riot_api_key())
        .send().await.map_err(|e| e.to_string())?
        .json().await.unwrap_or(json!({}));

    let match_ids = fetch_match_ids_since(&puuid, 0, 20, Some(SEASON_2026_START_SECS), &client).await;
    let mut match_details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        let detail = fetch_match_detail(id, &client).await;
        if detail.get("metadata").is_none() { continue; }
        let queue_id = detail["info"]["queueId"].as_u64().unwrap_or(1);
        if queue_id != 0 { match_details.push(detail); }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    let normalized_entries: Vec<Value> = ranked_entries.as_array().unwrap_or(&vec![])
        .iter().map(|e| {
            let mut entry = e.clone();
            if entry["rank"].is_null() || entry["rank"].as_str().unwrap_or("") == "" {
                if let Some(div) = e["division"].as_str() { entry["rank"] = json!(div); }
            }
            entry
        }).collect();

    let profile = json!({
        "gameName":          account["gameName"],
        "tagLine":           account["tagLine"],
        "summonerLevel":     summoner["summonerLevel"],
        "profileIconId":     summoner["profileIconId"],
        "xpSinceLastLevel":  0,
        "xpUntilNextLevel":  1,
    });
    let matches_json = json!(match_details);
    let ranked_json  = json!(normalized_entries);

    let result = json!({
        "puuid":           puuid,
        "profile":         profile,
        "ranked_entries":  ranked_json,
        "matches":         matches_json
    });

    // Salva in cache Turso (solo metadati, fire-and-forget)
    {
        let icon_id   = profile["profileIconId"].as_u64().unwrap_or(0);
        let level     = profile["summonerLevel"].as_u64().unwrap_or(0);
        let solo      = normalized_entries.iter()
            .find(|e| e["queueType"].as_str() == Some("RANKED_SOLO_5x5"));
        let solo_tier = solo.and_then(|e| e["tier"].as_str()).unwrap_or("").to_string();
        let solo_rank = solo.and_then(|e| e["rank"].as_str()).unwrap_or("").to_string();
        let solo_lp   = solo.and_then(|e| e["leaguePoints"].as_i64()).unwrap_or(0);
        db_index_summoner(
            puuid.clone(),
            account["gameName"].as_str().unwrap_or("").to_string(),
            account["tagLine"].as_str().unwrap_or("").to_string(),
            icon_id, level, solo_tier, solo_rank, solo_lp,
        );
    }

    // Salva in cache
    summoner_cache().await.write().await
        .insert(puuid, (std::time::Instant::now(), result.clone()));

    Ok(result)
}

/// Tier list via OP.GG MCP — cache in-memory 15 minuti.
#[tauri::command]
async fn get_tier_list() -> Result<String, String> {
    {
        let cache = tier_list_cache().await.read().await;
        if let Some((ts, cached)) = cache.as_ref() {
            if ts.elapsed() < std::time::Duration::from_secs(900) {
                eprintln!("[tier_list] cache HIT ({:.0}s)", ts.elapsed().as_secs_f32());
                return Ok(cached.clone());
            }
        }
    }
    eprintln!("[tier_list] cache MISS — fetching OP.GG MCP");

    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().unwrap();

    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": "lol_list_lane_meta_champions", "arguments": {
            "region": "euw", "lang": "en_US", "position_filter": "all"
        }}
    });

    let raw_text = client.post(OPGG_MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .json(&body).send().await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())?;

    eprintln!("[tier_list] risposta {} bytes, anteprima: {}", raw_text.len(), &raw_text[..raw_text.len().min(200)]);

    for line in raw_text.lines() {
        let data_str = line.trim().strip_prefix("data: ").unwrap_or(line.trim());
        if data_str.is_empty() { continue; }
        if let Ok(parsed) = serde_json::from_str::<Value>(data_str) {
            for path in &[
                parsed.pointer("/result/content"),
                parsed.pointer("/params/content"),
                parsed.pointer("/content"),
            ] {
                if let Some(content) = path.and_then(|v| v.as_array()) {
                    for item in content {
                        if item["type"] == "text" {
                            if let Some(text_val) = item["text"].as_str() {
                                *tier_list_cache().await.write().await =
                                    Some((std::time::Instant::now(), text_val.to_string()));
                                return Ok(text_val.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    Err(format!("Nessun testo nella risposta OP.GG. Anteprima: {}", &raw_text[..raw_text.len().min(400)]))
}

/// Indicizza in Turso tutti i player di un live game che hanno puuid + summoner_name noti.
/// Fire-and-forget (spawn) — non blocca il return del live game.
fn index_live_players(players: &Value) {
    let arr = match players.as_array() {
        Some(a) => a.clone(),
        None => return,
    };
    for p in arr {
        let puuid = match p["puuid"].as_str() {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        let name_tag = p["summoner_name"].as_str().unwrap_or("").to_string();
        if name_tag.is_empty() { continue; }
        let (game_name, tag_line) = if name_tag.contains('#') {
            let mut it = name_tag.splitn(2, '#');
            (it.next().unwrap_or("").to_string(), it.next().unwrap_or("EUW1").to_string())
        } else {
            (name_tag, "EUW1".to_string())
        };
        if game_name.is_empty() { continue; }
        let icon_id  = p["profile_icon_id"].as_u64().unwrap_or(0);
        let level    = p["summoner_level"].as_u64().unwrap_or(0);
        let tier     = p["tier"].as_str().unwrap_or("").to_string();
        let rank     = p["rank"].as_str().unwrap_or("").to_string();
        let lp       = p["lp"].as_i64().unwrap_or(0);
        db_index_summoner(puuid, game_name, tag_line, icon_id, level, tier, rank, lp);
    }
}

/// Live game per il giocatore loggato: LCD (porta 2999) + Spectator V5 in parallelo.
#[tauri::command]
async fn get_live_game() -> Result<Value, String> {
    // Cache hit — non serviamo se dati ranked incompleti (timeout al primo caricamento).
    {
        let cache = live_game_cache().await.read().await;
        if let Some((ts, cached)) = cache.get("self") {
            if ts.elapsed() < std::time::Duration::from_secs(25) {
                let players = cached["players"].as_array().map(|a| a.len()).unwrap_or(0);
                let ranked_count = cached["players"].as_array().map(|a|
                    a.iter().filter(|p| !p["tier"].as_str().unwrap_or("").is_empty()).count()
                ).unwrap_or(0);
                let queue = cached["queue_type"].as_str().unwrap_or("");
                let is_ranked = queue.contains("Ranked");
                if !is_ranked || players == 0 || ranked_count * 2 >= players {
                    return Ok(cached.clone());
                }
                eprintln!("[LiveGame] Cache ranked incompleta ({}/{}), refresh", ranked_count, players);
            }
        }
    }
    let lock_path = get_lockfile_path().ok_or("CLIENT_CLOSED")?;
    let content   = fs::read_to_string(&lock_path).map_err(|_| "CLIENT_CLOSED")?;
    let parts: Vec<&str> = content.split(':').collect();
    if parts.len() < 4 { return Err("CLIENT_CLOSED".into()); }
    let port     = parts[2];
    let password = parts[3].trim_end_matches('\n').trim_end_matches('\r');
    let auth     = general_purpose::STANDARD.encode(format!("riot:{}", password));
    let client   = Client::builder().danger_accept_invalid_certs(true).build().unwrap();

    let me: Value = client
        .get(&format!("https://127.0.0.1:{}/lol-summoner/v1/current-summoner", port))
        .header("Authorization", format!("Basic {}", auth))
        .send().await.map_err(|_| "CLIENT_CLOSED")?
        .json().await.unwrap_or(json!({}));

    let my_puuid         = me["puuid"].as_str().unwrap_or("").to_string();
    let my_summoner_name = me["gameName"].as_str().unwrap_or("").to_string();
    if my_puuid.is_empty() { return Err("CLIENT_CLOSED".into()); }

    let client_lcd       = client.clone();
    let client_spectator = client.clone();
    let puuid_for_spec   = my_puuid.clone();
    let name_for_lcd     = my_summoner_name.clone();

    let lcd_handle = tokio::spawn(async move {
        fetch_live_client_data(&client_lcd).await
            .map(|lcd| build_live_game_from_lcd(&lcd, &name_for_lcd))
    });

    let spec_handle = tokio::spawn(async move {
        fetch_spectator(&puuid_for_spec, &client_spectator).await
    });

    // LCD prima (risposta locale ~1ms).
    // Aspetta anche Spectator in parallelo: ci servono i puuid (LCD non li ha).
    let (lcd_result, spec_raw) = tokio::join!(
        async { lcd_handle.await.unwrap_or(None) },
        async { spec_handle.await.unwrap_or(None) }
    );

    if let Some(mut resp) = lcd_result {
        eprintln!("[LiveGame] Fonte: LCD");

        // Costruiamo la mappa name→puuid da Spectator (se disponibile),
        // così evitiamo fetch_puuid x10 e usiamo i puuid già presenti.
        let mut puuid_map: HashMap<String, String> = HashMap::new();
        if let Some(ref raw_spec) = spec_raw {
            let empty = vec![];
            for p in raw_spec["participants"].as_array().unwrap_or(&empty) {
                let puuid   = p["puuid"].as_str().unwrap_or("").to_string();
                let riot_id = p["riotId"].as_str().unwrap_or("").to_string();
                let name    = p["summonerName"].as_str().unwrap_or("").to_string();
                if !puuid.is_empty() {
                    if !riot_id.is_empty() { puuid_map.insert(riot_id, puuid.clone()); }
                    if !name.is_empty()    { puuid_map.insert(name,    puuid); }
                }
            }
        }

        // Se Spectator non disponibile, fallback a fetch_puuid per i player mancanti
        {
            let players_snap = resp["players"].as_array().cloned().unwrap_or_default();
            let missing: Vec<String> = players_snap.iter()
                .map(|p| p["summoner_name"].as_str().unwrap_or("").to_string())
                .filter(|n| !n.is_empty() && !puuid_map.contains_key(n.as_str()))
                .collect();
            if !missing.is_empty() {
                let resolve_handles: Vec<_> = missing.iter().map(|name| {
                    let n = name.clone();
                    let c = client.clone();
                    tokio::spawn(async move {
                        let parts: Vec<&str> = n.splitn(2, '#').collect();
                        if parts.len() != 2 { return (n, String::new()); }
                        let puuid = fetch_puuid(parts[0], parts[1], &c).await.unwrap_or_default();
                        (n, puuid)
                    })
                }).collect();
                for h in resolve_handles {
                    if let Ok((name, puuid)) = h.await {
                        if !puuid.is_empty() { puuid_map.insert(name, puuid); }
                    }
                }
            }
        }

        // Ranked in parallelo per tutti i puuid noti
        let puuid_vec: Vec<(String, String)> = puuid_map.iter()
            .map(|(n, p)| (n.clone(), p.clone()))
            .collect();
        let rank_handles: Vec<_> = puuid_vec.iter().map(|(_, puuid)| {
            let p = puuid.clone();
            let c = client.clone();
            tokio::spawn(async move { fetch_ranked_entry(p, c).await })
        }).collect();

        let mut rank_by_puuid: HashMap<String, (String, String, i64)> = HashMap::new();
        for (i, h) in rank_handles.into_iter().enumerate() {
            if let Ok(entry) = h.await {
                rank_by_puuid.insert(puuid_vec[i].1.clone(), entry);
            }
        }

        // Aggiorna is_me, puuid, tier, rank, lp per ogni player
        if let Some(arr) = resp["players"].as_array_mut() {
            for p in arr.iter_mut() {
                let name = p["summoner_name"].as_str().unwrap_or("").to_string();
                if let Some(puuid) = puuid_map.get(&name) {
                    p["puuid"]  = json!(puuid);
                    p["is_me"]  = json!(!my_puuid.is_empty() && puuid.as_str() == my_puuid.as_str());
                    if let Some((tier, rank, lp)) = rank_by_puuid.get(puuid) {
                        p["tier"] = json!(tier);
                        p["rank"] = json!(rank);
                        p["lp"]   = json!(lp);
                    }
                }
            }
        }
        // spec_handle già consumato nel join — non serve più
        let _ = spec_raw;

        // Indicizza i player in Turso (fire-and-forget)
        index_live_players(&resp["players"]);

        // Salva in cache
        live_game_cache().await.write().await
            .insert("self".to_string(), (std::time::Instant::now(), resp.clone()));

        return Ok(resp);
    }

    // Fallback: Spectator V5 (spec_raw già disponibile dal join)
    eprintln!("[LiveGame] LCD non disponibile, uso Spectator V5");
    match spec_raw {
        None      => Ok(json!({ "in_game": false, "game_time": 0, "queue_type": "", "players": [] })),
        Some(raw) => {
            let resp = build_live_game_response(&raw, &my_puuid, &client).await;
            index_live_players(&resp["players"]);
            live_game_cache().await.write().await
                .insert("self".to_string(), (std::time::Instant::now(), resp.clone()));
            Ok(resp)
        }
    }
}

/// Live game per un summoner specifico (ricerca profilo altrui) — solo Spectator V5.
#[tauri::command]
async fn check_live_game(puuid: String) -> Result<Value, String> {
    // Cache hit per puuid — invalida se ranked incompleti
    if !puuid.is_empty() {
        let cache = live_game_cache().await.read().await;
        if let Some((ts, cached)) = cache.get(&puuid) {
            if ts.elapsed() < std::time::Duration::from_secs(25) {
                let players = cached["players"].as_array().map(|a| a.len()).unwrap_or(0);
                let ranked_count = cached["players"].as_array().map(|a|
                    a.iter().filter(|p| !p["tier"].as_str().unwrap_or("").is_empty()).count()
                ).unwrap_or(0);
                let queue = cached["queue_type"].as_str().unwrap_or("");
                let is_ranked = queue.contains("Ranked");
                if !is_ranked || players == 0 || ranked_count * 2 >= players {
                    return Ok(cached.clone());
                }
            }
        }
    }
    eprintln!("[check_live_game] puuid={:.20}", &puuid);
    if puuid.is_empty() {
        return Ok(json!({ "in_game": false, "game_time": 0, "queue_type": "", "players": [] }));
    }
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(30))
        .build().unwrap();

    match fetch_spectator(&puuid, &client).await {
        None      => Ok(json!({ "in_game": false, "game_time": 0, "queue_type": "", "players": [] })),
        Some(raw) => {
            let resp = build_live_game_response(&raw, &puuid, &client).await;
            index_live_players(&resp["players"]);
            if !puuid.is_empty() {
                live_game_cache().await.write().await
                    .insert(puuid, (std::time::Instant::now(), resp.clone()));
            }
            Ok(resp)
        }
    }
}

/// Recupera le maestrie del summoner — cache in-memory TTL 10 minuti.
#[tauri::command]
async fn get_summoner_masteries(puuid: String) -> Result<Value, String> {
    {
        let cache = masteries_cache().await.read().await;
        if let Some((ts, cached)) = cache.get(&puuid) {
            if ts.elapsed() < std::time::Duration::from_secs(600) {
                return Ok(cached.clone());
            }
        }
    }

    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(15))
        .build().unwrap();

    let url = format!(
        "https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/{}/top?count=20",
        puuid
    );
    let res = client.get(&url).header("X-Riot-Token", riot_api_key())
        .send().await.map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    if status == 404 { return Ok(json!([])); }
    if status != 200 { return Err(format!("Riot API errore {}", status)); }

    let masteries: Value = res.json().await.map_err(|_| "Errore JSON masteries")?;
    masteries_cache().await.write().await
        .insert(puuid, (std::time::Instant::now(), masteries.clone()));
    Ok(masteries)
}

/// Timeline di un match per gli acquisti item per minuto.
#[tauri::command]
async fn get_match_timeline(match_id: String) -> Result<Value, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(15))
        .build().unwrap();

    let url = format!(
        "https://europe.api.riotgames.com/lol/match/v5/matches/{}/timeline",
        match_id
    );
    for attempt in 0..3u32 {
        let res = client.get(&url).header("X-Riot-Token", riot_api_key())
            .send().await.map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        if status == 429 {
            tokio::time::sleep(std::time::Duration::from_millis(2000 * (attempt + 1) as u64)).await;
            continue;
        }
        if status != 200 { return Err(format!("Riot API timeline error {}", status)); }
        return res.json().await.map_err(|_| "Errore JSON timeline".into());
    }
    Err("Timeline fetch fallita dopo 3 tentativi".into())
}

/// Suggerisce summoner per l'autocomplete a partire da quelli già cercati/visti.
/// Legge dalla summoner_cache Turso (solo metadati, no matches).
/// Restituisce fino a 6 risultati con icona, livello e rank per il dropdown.
#[tauri::command]
async fn search_summoner_suggestions(query: String) -> Result<Value, String> {
    let q = query.trim().to_string();
    if q.len() < 2 { return Ok(json!([])); }

    let (name_q, tag_q) = if q.contains('#') {
        let mut parts = q.splitn(2, '#');
        (parts.next().unwrap_or("").to_string(), Some(parts.next().unwrap_or("").to_string()))
    } else {
        (q.clone(), None)
    };

    let rows = if let Some(tag) = tag_q {
        turso_query(
            "SELECT game_name, tag_line, profile, solo_tier, solo_rank, solo_lp
             FROM summoner_cache
             WHERE LOWER(game_name) LIKE ?1 AND LOWER(tag_line) LIKE ?2
             ORDER BY cached_at DESC LIMIT 6",
            vec![
                json!(format!("{}%", name_q.to_lowercase())),
                json!(format!("{}%", tag.to_lowercase())),
            ],
        ).await.unwrap_or_default()
    } else {
        turso_query(
            "SELECT game_name, tag_line, profile, solo_tier, solo_rank, solo_lp
             FROM summoner_cache
             WHERE LOWER(game_name) LIKE ?1
             ORDER BY cached_at DESC LIMIT 6",
            vec![json!(format!("%{}%", name_q.to_lowercase()))],
        ).await.unwrap_or_default()
    };

    let suggestions: Vec<Value> = rows.iter().filter_map(|row| {
        let mut iter = row.iter();
        let game_name = iter.next()?.as_str()?.to_string();
        let tag_line  = iter.next()?.as_str()?.to_string();
        let profile: Value = serde_json::from_str(iter.next()?.as_str()?).ok()?;
        let tier = iter.next()?.as_str().unwrap_or("").to_string();
        let rank = iter.next()?.as_str().unwrap_or("").to_string();
        let lp   = iter.next()?.as_i64().unwrap_or(0);
        Some(json!({
            "name":          game_name,
            "tag":           tag_line,
            "profileIconId": profile["profileIconId"],
            "summonerLevel": profile["summonerLevel"],
            "tier":          tier,
            "rank":          rank,
            "lp":            lp,
        }))
    }).collect();

    Ok(json!(suggestions))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_profiles,
            get_more_matches,
            search_summoner,
            get_tier_list,
            get_live_game,
            check_live_game,
            get_summoner_masteries,
            get_match_timeline,
            search_summoner_suggestions,
            get_champ_select_session,
            auto_import_build,
            apply_rune_page,
            debug_champ_select_slot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}