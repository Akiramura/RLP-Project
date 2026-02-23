#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{fs, path::PathBuf};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use base64::{engine::general_purpose, Engine as _};
use reqwest::Client;
use tokio::sync::OnceCell;
use deadpool_postgres::{Config, Pool, Runtime, ManagerConfig, RecyclingMethod};
use native_tls::TlsConnector;
use postgres_native_tls::MakeTlsConnector;

// ── Cargo.toml dependencies needed ──────────────────────────────────────────
// deadpool-postgres = { version = "0.14", features = ["rt_tokio_1"] }
// tokio-postgres    = { version = "0.7" }
// postgres-native-tls = "0.5"
// native-tls        = "0.2"
// dotenvy           = "0.15"
// ────────────────────────────────────────────────────────────────────────────

mod champ_select;
use champ_select::{get_champ_select_session, auto_import_build, debug_champ_select_slot};

const OPGG_MCP_URL: &str = "https://mcp-api.op.gg/mcp";

/// RIOT_API_KEY compilata dentro il binario al momento della build.
/// Impostala come variabile d'ambiente prima di `npm run tauri build`
/// oppure tramite .cargo/config.toml (non va committato su git).
fn riot_api_key() -> &'static str {
    env!("RIOT_API_KEY")
}

use std::collections::HashSet;
use tokio::sync::RwLock;

// OnceCell stores Option<Pool> so we never retry a failed init
static POOL: OnceCell<Option<Pool>> = OnceCell::const_new();

/// Match ID già identificati come pre-Season 2026: saltati senza chiamare Riot API né Neon.
static PRE2026_SKIP: OnceCell<RwLock<HashSet<String>>> = OnceCell::const_new();

async fn pre2026_skip() -> &'static RwLock<HashSet<String>> {
    PRE2026_SKIP.get_or_init(|| async { RwLock::new(HashSet::new()) }).await
}

async fn get_pool() -> Option<&'static Pool> {
    POOL.get_or_init(|| async {
        let mut cfg = Config::new();
        cfg.host     = Some(env!("NEON_HOST").to_string());
        cfg.port     = Some(env!("NEON_PORT", "5432").parse::<u16>().unwrap_or(5432));
        cfg.dbname   = Some(env!("NEON_DB").to_string());
        cfg.user     = Some(env!("NEON_USER").to_string());
        cfg.password = Some(env!("NEON_PASSWORD").to_string());
        cfg.manager  = Some(ManagerConfig { recycling_method: RecyclingMethod::Fast });

        let connector = match TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()
        {
            Ok(c)  => c,
            Err(e) => { eprintln!("❌ TLS error: {}", e); return None; }
        };
        let tls = MakeTlsConnector::new(connector);

        let pool: Pool = match cfg.create_pool(Some(Runtime::Tokio1), tls) {
            Ok(p)  => p,
            Err(e) => { eprintln!("❌ Pool create error: {}", e); return None; }
        };

        let client = match pool.get().await {
            Ok(c)  => c,
            Err(e) => { eprintln!("❌ Pool get error: {}", e); return None; }
        };
        if let Err(e) = client.batch_execute("
            CREATE TABLE IF NOT EXISTS match_cache (
                match_id   TEXT PRIMARY KEY,
                data       JSONB NOT NULL,
                cached_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS summoner_cache (
                puuid          TEXT PRIMARY KEY,
                game_name      TEXT NOT NULL,
                tag_line       TEXT NOT NULL,
                profile        JSONB NOT NULL,
                ranked_entries JSONB NOT NULL,
                matches        JSONB NOT NULL,
                cached_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        ").await {
            eprintln!("❌ Tabelle error: {}", e);
            return None;
        }

        println!("✓ Neon pool pronto.");
        Some(pool)
    }).await.as_ref()
}

// ── Season filter ────────────────────────────────────────────────────────────

/// Filtra un array JSON di match tenendo solo quelli Season 2026+ e non-custom.
/// gameCreation è in millisecondi (Riot API), SEASON_2026_START_SECS è in secondi.
fn filter_season_matches(matches: Value) -> Value {
    const SEASON_2026_START_MS: u64 = 1_767_830_400 * 1000;
    match matches.as_array() {
        None => matches,
        Some(arr) => {
            let filtered: Vec<Value> = arr.iter().filter(|m| {
                // Filtro data: solo Season 2026+
                let gc = m["info"]["gameCreation"].as_u64()
                    .or_else(|| m["gameCreation"].as_u64())
                    .unwrap_or(u64::MAX);
                if gc < SEASON_2026_START_MS { return false; }

                // Filtro tipo: escludi custom (queueId == 0)
                let queue_id = m["info"]["queueId"].as_u64()
                    .or_else(|| m["queueId"].as_u64())
                    .unwrap_or(1); // se mancante, teniamo il match
                if queue_id == 0 { return false; }

                true
            }).cloned().collect();
            json!(filtered)
        }
    }
}

// ── DB helpers ───────────────────────────────────────────────────────────────

async fn db_get_match(match_id: &str) -> Option<Value> {
    let pool: &Pool = get_pool().await?;
    let pg = pool.get().await
        .map_err(|e| eprintln!("❌ db_get_match pool: {}", e)).ok()?;
    let row = pg
        .query_opt("SELECT data::text FROM match_cache WHERE match_id = $1", &[&match_id])
        .await.ok()??;
    let raw: String = row.get(0);
    serde_json::from_str(&raw).ok()
}

async fn db_save_match(match_id: &str, data: &Value) {
    let pool: &Pool = match get_pool().await { Some(p) => p, None => return };
    let pg = match pool.get().await {
        Ok(c)  => c,
        Err(e) => { eprintln!("❌ db_save_match pool: {}", e); return; }
    };
    let _ = pg.execute(
        "INSERT INTO match_cache (match_id, data) VALUES ($1, $2)",
        &[&match_id, data],
    ).await;
}

async fn db_delete_match(match_id: &str) {
    let pool: &Pool = match get_pool().await { Some(p) => p, None => return };
    let pg = match pool.get().await {
        Ok(c)  => c,
        Err(e) => { eprintln!("❌ db_delete_match pool: {}", e); return; }
    };
    match pg.execute("DELETE FROM match_cache WHERE match_id = $1", &[&match_id]).await {
        Ok(n)  => if n > 0 { println!("🗑 Rimosso da Neon match pre-2026: {}", match_id); },
        Err(e) => eprintln!("❌ db_delete_match {}: {}", match_id, e),
    }
}

async fn db_get_summoner(puuid: &str) -> Option<Value> {
    let pool: &Pool = get_pool().await?;
    let pg = pool.get().await
        .map_err(|e| eprintln!("❌ db_get_summoner pool: {}", e)).ok()?;
    let row = pg.query_opt(
        "SELECT profile::text, ranked_entries::text, matches::text, cached_at
         FROM summoner_cache WHERE puuid = $1",
        &[&puuid],
    ).await.ok()??;

    let cached_at: chrono::DateTime<chrono::Utc> = row.get(3);
    let age: chrono::TimeDelta = chrono::Utc::now() - cached_at;
    let mins = age.num_minutes();
    if mins > 60 {
        println!("Cache summoner {} scaduta ({} min), rifresco.", puuid, mins);
        return None;
    }

    let profile: Value        = serde_json::from_str(&row.get::<_, String>(0)).ok()?;
    let ranked_entries: Value = serde_json::from_str(&row.get::<_, String>(1)).ok()?;
    let matches: Value        = serde_json::from_str(&row.get::<_, String>(2)).ok()?;

    // Filtra solo partite Season 2026 (gameCreation >= 1767830400000 ms)
    let matches = filter_season_matches(matches);

    // Se dopo il filtro non restano partite, la cache è obsoleta → forza refetch
    if matches.as_array().map(|a| a.is_empty()).unwrap_or(true) {
        println!("Cache summoner {} contiene solo partite pre-Season 2026, invalido.", puuid);
        return None;
    }

    Some(json!({
        "puuid": puuid,
        "profile": profile,
        "ranked_entries": ranked_entries,
        "matches": matches,
        "_from_cache": true
    }))
}

/// Come db_get_summoner ma ignora la scadenza — usato in modalità offline.
async fn db_get_summoner_offline(puuid: &str) -> Option<Value> {
    let pool: &Pool = get_pool().await?;
    let pg = pool.get().await
        .map_err(|e| eprintln!("❌ db_get_summoner_offline pool: {}", e)).ok()?;
    let row = pg.query_opt(
        "SELECT profile::text, ranked_entries::text, matches::text, cached_at
         FROM summoner_cache WHERE puuid = $1",
        &[&puuid],
    ).await.ok()??;

    let cached_at: chrono::DateTime<chrono::Utc> = row.get(3);
    let age_mins = (chrono::Utc::now() - cached_at).num_minutes();
    println!("[Offline] Uso cache Neon per {} ({} min fa)", puuid, age_mins);

    let profile: Value        = serde_json::from_str(&row.get::<_, String>(0)).ok()?;
    let ranked_entries: Value = serde_json::from_str(&row.get::<_, String>(1)).ok()?;
    let matches: Value        = serde_json::from_str(&row.get::<_, String>(2)).ok()?;

    // Filtra solo partite Season 2026
    let matches = filter_season_matches(matches);

    // Offline: mantieni anche cache vuota (meglio che niente), ma logga
    if matches.as_array().map(|a| a.is_empty()).unwrap_or(true) {
        println!("[Offline] Cache {} contiene solo partite pre-Season 2026.", puuid);
    }

    Some(json!({
        "puuid": puuid,
        "profile": profile,
        "ranked_entries": ranked_entries,
        "matches": matches,
        "_from_cache": true,
        "_offline": true,
        "_cache_age_minutes": age_mins
    }))
}

async fn db_save_summoner(puuid: &str, profile: &Value, ranked_entries: &Value, matches: &Value) {
    let pool: &Pool = match get_pool().await { Some(p) => p, None => return };
    let pg = match pool.get().await {
        Ok(c)  => c,
        Err(e) => { eprintln!("❌ db_save_summoner pool: {}", e); return; }
    };
    let gn = profile["gameName"].as_str().unwrap_or("").to_string();
    let tl = profile["tagLine"].as_str().unwrap_or("").to_string();
    match pg.execute(
        "INSERT INTO summoner_cache (puuid, game_name, tag_line, profile, ranked_entries, matches, cached_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (puuid) DO UPDATE SET
           profile        = EXCLUDED.profile,
           ranked_entries = EXCLUDED.ranked_entries,
           matches        = EXCLUDED.matches,
           cached_at      = NOW()",
        &[&puuid, &gn.as_str(), &tl.as_str(), profile, ranked_entries, matches],
    ).await {
        Ok(_)  => println!("✓ Summoner {} salvato in Neon.", puuid),
        Err(e) => eprintln!("❌ Salvataggio summoner {}: {}", puuid, e),
    }
}

/// Recupera profilo, ranked e match via Riot API pubblica (senza LCU).
/// Usata quando il client è chiuso per avere dati freschi.
async fn fetch_profile_from_riot_api(
    game_name: &str,
    tag_line: &str,
    client: &Client,
) -> Option<Value> {
    println!("[RLP] Client chiuso → fetch Riot API per {}", game_name);

    let puuid = fetch_puuid(game_name, tag_line, client).await?;

    // Ranked entries
    let ranked_text = client
        .get(&format!(
            "https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/{}",
            puuid
        ))
        .header("X-Riot-Token", riot_api_key())
        .send().await.ok()?
        .text().await.unwrap_or_default();
    let ranked_entries: Value = serde_json::from_str(&ranked_text).unwrap_or(json!([]));

    // Summoner (level + icon)
    let summoner: Value = client
        .get(&format!(
            "https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{}",
            puuid
        ))
        .header("X-Riot-Token", riot_api_key())
        .send().await.ok()?
        .json().await.unwrap_or(json!({}));

    // Ultimi 10 match
    let match_ids = fetch_match_ids(&puuid, 0, 10, client).await;
    let mut match_details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        match_details.push(fetch_match_detail(id, client).await);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    // Normalizza ranked_entries (rank → division per compatibilità mapRanked)
    let normalized_entries: Vec<Value> = ranked_entries
        .as_array().unwrap_or(&vec![])
        .iter().map(|e| {
            let mut entry = e.clone();
            if entry["division"].is_null() || entry["division"].as_str().unwrap_or("") == "" {
                if let Some(div) = e["rank"].as_str() {
                    entry["division"] = json!(div);
                }
            }
            entry
        }).collect();

    let queues = normalized_entries.clone();

    let profile = json!({
        "gameName": game_name,
        "tagLine": tag_line,
        "summonerLevel": summoner["summonerLevel"],
        "profileIconId": summoner["profileIconId"],
        "xpSinceLastLevel": 0,
        "xpUntilNextLevel": 1,
    });

    let matches_json  = json!(match_details);
    let ranked_json   = json!(normalized_entries);

    // Salva in Neon e cache locale per usi futuri
    db_save_summoner(&puuid, &profile, &ranked_json, &matches_json).await;

    println!("[RLP] Riot API fetch completato per {} ({} match)", game_name, match_details.len());

    Some(json!({
        "puuid": puuid,
        "profile": profile,
        "ranked": { "queues": queues },
        "ranked_entries": ranked_json,
        "matches": matches_json,
        "last_update": chrono::Utc::now().to_rfc3339()
    }))
}

/// Tenta di recuperare i dati quando il client è chiuso:
/// 1. Riot API pubblica (dati freschi, sempre)
/// 2. Neon cache (ignorando scadenza, se Riot API non è raggiungibile)
/// 3. Cache locale JSON (ultimo fallback)
async fn offline_fallback(cached_data: &Option<Value>) -> Result<Value, String> {
    // Recupera game_name e tag_line dalla cache locale per poter chiamare Riot API
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
                .build()
                .unwrap();

            if let Some(fresh) = fetch_profile_from_riot_api(game_name, tag_line, &client).await {
                println!("[RLP] Dati freschi da Riot API (client chiuso).");
                return Ok(fresh);
            }
            println!("[RLP] Riot API non raggiungibile, provo Neon...");
        }

        // Fallback Neon
        if let Some(puuid) = cache["puuid"].as_str() {
            if !puuid.is_empty() {
                if let Some(neon_data) = db_get_summoner_offline(puuid).await {
                    println!("[RLP] Dati da Neon cache per puuid={}", puuid);
                    let profile = neon_data["profile"].clone();
                    let matches = neon_data["matches"].clone();
                    let queues: Vec<Value> = neon_data["ranked_entries"]
                        .as_array().cloned().unwrap_or_default()
                        .into_iter().map(|mut e| {
                            if e["division"].is_null() {
                                let rank_val = e["rank"].clone();
                                e["division"] = rank_val;
                            }
                            e
                        }).collect();
                    return Ok(json!({
                        "puuid": puuid,
                        "profile": profile,
                        "ranked": { "queues": queues },
                        "matches": matches,
                        "_offline": true,
                        "_cache_age_minutes": neon_data["_cache_age_minutes"]
                    }));
                }
            }
        }
    }

    // Fallback finale: cache locale
    match cached_data {
        Some(cache) => {
            println!("[RLP] Uso cache locale (file) come ultimo fallback.");
            Ok(cache.clone())
        }
        None => Err("CLIENT_CLOSED".into()),
    }
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

fn get_cache_path(handle: &AppHandle) -> PathBuf {
    handle.path().app_cache_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("cache.json")
}

/// Percent-encodes un path segment RFC-3986.
/// Itera sui BYTE UTF-8 (non codepoint Unicode) per encoding corretto
/// anche con caratteri non-ASCII (coreano, cinese, emoji...).
/// Es: '망' (U+B9DD) → bytes [0xEB, 0xA7, 0x9D] → "%EB%A7%9D"
fn encode_path(s: &str) -> String {
    s.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
        | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        b' ' => "%20".to_string(),
        b    => format!("%{:02X}", b),
    }).collect::<Vec<_>>().join("")
}

async fn fetch_puuid(game_name: &str, tag_line: &str, client: &Client) -> Option<String> {
    let url = format!(
        "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{}/{}",
        encode_path(game_name), encode_path(tag_line)
    );
    println!("[fetch_puuid] GET {}", url);
    let res = match client.get(&url).header("X-Riot-Token", riot_api_key()).send().await {
        Ok(r)  => r,
        Err(e) => { eprintln!("❌ fetch_puuid network error: {}", e); return None; }
    };
    let status = res.status().as_u16();
    let body   = res.text().await.unwrap_or_default();
    if status != 200 {
        eprintln!("❌ fetch_puuid HTTP {} per '{}#{}': {}", status, game_name, tag_line,
            &body[..body.len().min(300)]);
        return None;
    }
    let data: Value = serde_json::from_str(&body).ok()?;
    data["puuid"].as_str().map(|s| s.to_string())
}

async fn fetch_match_ids(puuid: &str, start: u32, count: u32, client: &Client) -> Vec<String> {
    fetch_match_ids_since(puuid, start, count, None, client).await
}

const SEASON_2026_START_SECS: u64 = 1_767_830_400; // 2026-01-08 00:00:00 UTC

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
                    let wait = 2000 * (attempt + 1) as u64;
                    println!("Rate limit fetch_match_ids, attendo {}ms...", wait);
                    tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
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
    const SEASON_2026_START_MS: u64 = 1_767_830_400 * 1000; // 2026-01-08 00:00:00 UTC

    // Controllo fast-path: già identificato come pre-2026 in questa sessione
    {
        let skip = pre2026_skip().await.read().await;
        if skip.contains(match_id) {
            return json!({});
        }
    }

    if let Some(cached) = db_get_match(match_id).await {
        let gc = cached["info"]["gameCreation"].as_u64()
            .or_else(|| cached["gameCreation"].as_u64())
            .unwrap_or(u64::MAX);
        if gc < SEASON_2026_START_MS {
            println!("🗑 Neon match pre-2026 (gc={}), cancello: {}", gc, match_id);
            db_delete_match(match_id).await;
            // Aggiunge al set in-memory per evitare doppie chiamate
            pre2026_skip().await.write().await.insert(match_id.to_string());
            return json!({});
        }
        println!("✓ Cache hit Neon: {}", match_id);
        return cached;
    }

    // Non in Neon: fetcha da Riot API. Se la data risulta pre-2026, non salvare.
    let url = format!("https://europe.api.riotgames.com/lol/match/v5/matches/{}", match_id);
    for attempt in 0..3u32 {
        match client.get(&url).header("X-Riot-Token", riot_api_key()).send().await {
            Ok(res) => {
                if res.status().as_u16() == 429 {
                    let wait = 2000 * (attempt + 1) as u64;
                    println!("Rate limit fetch_match_detail {}, attendo {}ms...", match_id, wait);
                    tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
                    continue;
                }
                let data = res.json::<Value>().await.unwrap_or(json!({}));
                if data.get("metadata").is_some() {
                    let gc = data["info"]["gameCreation"].as_u64().unwrap_or(u64::MAX);
                    if gc < SEASON_2026_START_MS {
                        println!("🗑 Riot API match pre-2026 (gc={}), scarto: {}", gc, match_id);
                        pre2026_skip().await.write().await.insert(match_id.to_string());
                        return json!({});
                    }
                    db_save_match(match_id, &data).await;
                }
                return data;
            }
            Err(_) => return json!({}),
        }
    }
    json!({})
}

async fn call_opgg_tool(tool_name: &str, arguments: Value, client: &Client) -> Result<Value, String> {
    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": tool_name, "arguments": arguments }
    });
    let res  = client.post(OPGG_MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .json(&body).send().await.map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    for line in text.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                if let Some(content) = parsed["result"]["content"].as_array() {
                    for item in content {
                        if item["type"] == "text" {
                            if let Some(text_val) = item["text"].as_str() {
                                if let Ok(inner) = serde_json::from_str::<Value>(text_val) {
                                    return Ok(inner);
                                }
                            }
                        }
                    }
                }
                return Ok(parsed);
            }
        }
    }
    Err(format!("Risposta OP.GGG non valida (primi 800 car): {}", &text[..800.min(text.len())]))
}

// ── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn get_profiles(handle: AppHandle) -> Result<Value, String> {
    let cache_p = get_cache_path(&handle);

    let cached_data: Option<Value> = fs::read_to_string(&cache_p).ok()
        .and_then(|s| serde_json::from_str(&s).ok());

    let lock_path = match get_lockfile_path() {
        Some(p) => p,
        None    => {
            eprintln!("[RLP] Client chiuso (no lockfile), provo offline fallback.");
            return offline_fallback(&cached_data).await;
        }
    };

    if !lock_path.exists() {
        eprintln!("[RLP] Lockfile assente, provo offline fallback.");
        return offline_fallback(&cached_data).await;
    }

    let content  = fs::read_to_string(lock_path).map_err(|_| "Errore lockfile")?;
    let parts: Vec<&str> = content.split(':').collect();
    let port     = parts[2];
    let password = parts[3];
    let auth     = general_purpose::STANDARD.encode(format!("riot:{}", password));

    let client = Client::builder().danger_accept_invalid_certs(true).build().unwrap();

    let lcu_resp = client
        .get(&format!("https://127.0.0.1:{}/lol-summoner/v1/current-summoner", port))
        .header("Authorization", format!("Basic {}", auth))
        .send().await;

    // Se la connessione viene rifiutata (client chiuso ma lockfile ancora presente),
    // usa la cache locale invece di propagare l'errore.
    let lcu_resp = match lcu_resp {
        Ok(r) => r,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("connection refused") || msg.contains("actively refused")
                || msg.contains("tcp connect") || msg.contains("os error 10061")
                || msg.contains("os error 111")
            {
                eprintln!("[RLP] LCU non raggiungibile ({}), provo offline fallback.", msg);
                return offline_fallback(&cached_data).await;
            }
            return Err(msg);
        }
    };

    let current_profile: Value = lcu_resp.json().await.map_err(|_| "Errore JSON profilo")?;

    let game_name = current_profile["gameName"].as_str().unwrap_or("").to_string();
    let tag_line  = current_profile["tagLine"].as_str().unwrap_or("").to_string();

    // Se gameName e' un ID temporaneo di match (es: "teambuilder-match-7743720497")
    // il client e' in uno stato transitorio. Restituiamo la cache se disponibile,
    // altrimenti segnaliamo che il client non e' pronto.
    if game_name.is_empty() || game_name.contains("-match-") || game_name.starts_with("teambuilder-") {
        eprintln!("[RLP] gameName transitorio: '{}', uso cache o attendo", game_name);
        return cached_data.ok_or("CLIENT_NOT_READY".into());
    }

    if tag_line.is_empty() {
        return Err("Impossibile leggere tagLine dal client".into());
    }

    let puuid = fetch_puuid(&game_name, &tag_line, &client).await
        .ok_or("Impossibile recuperare PUUID da Riot API")?;

    if let Some(cache) = &cached_data {
        let cached_puuid      = cache["puuid"].as_str().unwrap_or("");
        let matches_are_objects = cache["matches"].as_array()
            .and_then(|arr| arr.first()).map(|f| f.is_object()).unwrap_or(false);

        // Controlla l'età della cache locale (max 30 minuti)
        let cache_is_fresh = cache["last_update"].as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| {
                let age = chrono::Utc::now() - dt.with_timezone(&chrono::Utc);
                age.num_minutes() < 30
            })
            .unwrap_or(false);

        if cached_puuid == puuid && !puuid.is_empty() && matches_are_objects && cache_is_fresh {
            let mut cached = cache.clone();
            // Filtra match pre-season anche dalla cache locale
            if let Some(matches) = cached.get("matches").cloned() {
                let filtered = filter_season_matches(matches);
                // Se non restano partite Season 2026, la cache è obsoleta → rifresca
                if filtered.as_array().map(|a| a.is_empty()).unwrap_or(true) {
                    println!("[RLP] Cache locale contiene solo partite pre-Season 2026, invalido.");
                } else {
                    cached["matches"] = filtered;
                    println!("[RLP] Cache locale valida (< 30 min).");
                    return Ok(cached);
                }
            } else {
                println!("[RLP] Cache locale valida (< 30 min).");
                return Ok(cached);
            }
        } else if cached_puuid == puuid && !cache_is_fresh {
            println!("[RLP] Cache locale scaduta, rifresco da LCU.");
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
        // Salta match vuoti (pre-2026 cancellati da Neon) e custom (queueId == 0)
        if detail.get("metadata").is_none() { continue; }
        let queue_id = detail["info"]["queueId"].as_u64().unwrap_or(1);
        if queue_id != 0 { match_details.push(detail); }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    let final_data = json!({
        "puuid": puuid, "profile": current_profile, "ranked": ranked,
        "matches": match_details, "last_update": chrono::Utc::now().to_rfc3339()
    });
    let _ = fs::write(cache_p, final_data.to_string());
    Ok(final_data)
}

#[tauri::command]
async fn get_more_matches(puuid: String, start: u32) -> Result<Value, String> {
    let client    = Client::builder().danger_accept_invalid_certs(true).build().unwrap();
    let match_ids = fetch_match_ids_since(&puuid, start, 10, Some(SEASON_2026_START_SECS), &client).await;
    let mut details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        println!("Fetching extra match: {}", id);
        let detail = fetch_match_detail(id, &client).await;
        // Salta match vuoti (pre-2026 cancellati da Neon)
        if detail.get("metadata").is_none() { continue; }
        // Salta partite custom (queueId == 0)
        let queue_id = detail["info"]["queueId"].as_u64().unwrap_or(1);
        if queue_id == 0 { continue; }
        // Salta partite pre-Season 2026 (doppio controllo lato dettaglio)
        const SEASON_2026_START_MS: u64 = 1_767_830_400 * 1000;
        let gc = detail["info"]["gameCreation"].as_u64().unwrap_or(u64::MAX);
        if gc < SEASON_2026_START_MS { continue; }
        details.push(detail);
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    Ok(json!(details))
}

#[tauri::command]
async fn search_summoner(game_name: String, tag_line: String) -> Result<Value, String> {
    let client = Client::builder().danger_accept_invalid_certs(true).build().unwrap();

    let puuid = fetch_puuid(&game_name, &tag_line, &client).await
        .ok_or("Summoner non trovato. Controlla nome e tag.")?;

    if let Some(cached) = db_get_summoner(&puuid).await {
        println!("✓ Cache Neon hit per {}", puuid);
        return Ok(cached);
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
        "gameName": account["gameName"], "tagLine": account["tagLine"],
        "summonerLevel": summoner["summonerLevel"], "profileIconId": summoner["profileIconId"],
        "xpSinceLastLevel": 0, "xpUntilNextLevel": 1,
    });
    let matches_json = json!(match_details);
    let ranked_json  = json!(normalized_entries);

    db_save_summoner(&puuid, &profile, &ranked_json, &matches_json).await;

    Ok(json!({
        "puuid": puuid,
        "profile": profile,
        "ranked_entries": ranked_json,
        "matches": matches_json
    }))
}

#[tauri::command]
async fn get_opgg_data(game_name: String, tag_line: String) -> Result<Value, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().unwrap();
    let profile_result = call_opgg_tool("lol_get_summoner_profile", json!({
        "summoner_id": format!("{}#{}", game_name, tag_line), "region": "euw",
        "desired_output_fields": [
            "data.summoner.{game_name,tagline,level}",
            "data.summoner.league_stats[].{game_type,win,lose,is_ranked}",
            "data.summoner.league_stats[].tier_info.{tier,division,lp}",
            "data.summoner.most_champion_stats[].{champion_id,play,win,lose,kill,death,assist,kda}"
        ]
    }), &client).await;
    let meta_result = call_opgg_tool("lol_list_lane_meta_champions", json!({
        "region": "euw",
        "desired_output_fields": ["data[].{champion_id,position,tier,win_rate,pick_rate,ban_rate,kda}"]
    }), &client).await;
    Ok(json!({
        "profile": profile_result.unwrap_or(json!(null)),
        "meta":    meta_result.unwrap_or(json!(null)),
    }))
}

#[tauri::command]
async fn list_opgg_tools() -> Result<Value, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0")
        .build().unwrap();
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
        "params": {}
    });
    let res = client.post(OPGG_MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .json(&body).send().await.map_err(|e| e.to_string())?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    for line in text.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                return Ok(parsed);
            }
        }
    }
    serde_json::from_str(&text).map_err(|_| format!("Raw: {}", &text[..text.len().min(500)]))
}

/// Parsa il formato testuale proprietario OP.GG.
///
/// STRUTTURA REALE dell'API:
///   LolListLaneMetaChampions("en_US","all",Data(Positions(
///     [Top("Ornn",...),Top("Singed",...),...],   ← indice 0 = top
///     [Top("Ahri",...), ...],                    ← indice 1 = mid
///     [Top("Kha'Zix",...), ...],                 ← indice 2 = jungle
///     [Top("Jinx",...), ...],                    ← indice 3 = adc
///     [Top("Nami",...), ...]                     ← indice 4 = support
///   )))
///
/// NOTA CRITICA: OP.GG usa "Top(" come class name per TUTTE e 5 le lane.
/// La lane si determina SOLO dalla posizione dell'array (0=top,1=mid,...).
fn parse_opgg_text(text: &str) -> Value {
    // Ordine fisso dei 5 array dentro Positions(...)
    let lane_order = ["top", "mid", "jungle", "adc", "support"];
    let mut all_champions: Vec<Value> = Vec::new();

    // 1. Trova "Positions([" e il byte-offset dell'apertura '('
    let marker = "Positions(";
    let pos_marker_start = match text.find(marker) {
        Some(p) => p,
        None => {
            eprintln!("[parse_opgg_text] 'Positions(' non trovato, fallback");
            return parse_opgg_text_fallback(text);
        }
    };
    let pos_open = pos_marker_start + marker.len(); // indice della '(' di apertura

    // 2. Estrai tutto il contenuto di Positions(...) contando le parentesi TONDE
    let positions_content = {
        let after = &text[pos_open..];
        let mut depth = 0i32;
        let mut end = after.len();
        for (i, ch) in after.char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 { end = i; break; }
                }
                _ => {}
            }
        }
        // positions_content = "([Top(...),...],[Top(...),...],..." (include le [ ] esterne)
        &after[..end]
    };

    eprintln!("[parse_opgg_text] positions_content len={}, anteprima: {}",
        positions_content.len(),
        &positions_content[..positions_content.len().min(80)]);

    // 3. Splitta i 5 gruppi trovando ']' a profondità parentetica 0
    //    positions_content inizia con '(' poi '[', es: "([Top(...),...],[Top(...),...],...)"
    let mut groups: Vec<&str> = Vec::new();
    {
        let chars: Vec<(usize, char)> = positions_content.char_indices().collect();
        let len = chars.len();
        let mut depth = 0i32;
        let mut group_start: Option<usize> = None; // byte-offset dell'apertura '['

        let mut i = 0;
        while i < len {
            let (byte_i, ch) = chars[i];
            match ch {
                '[' if depth == 0 => {
                    group_start = Some(byte_i + 1); // dopo la '['
                }
                '(' => depth += 1,
                ')' => depth -= 1,
                ']' if depth == 0 => {
                    if let Some(start) = group_start {
                        groups.push(&positions_content[start..byte_i]);
                        group_start = None;
                    }
                }
                _ => {}
            }
            i += 1;
        }
    }

    eprintln!("[parse_opgg_text] Trovati {} gruppi (attesi 5)", groups.len());

    // 4. Per ogni gruppo parsa i record "Top(...)"
    for (idx, group) in groups.iter().enumerate() {
        let lane = match lane_order.get(idx) {
            Some(&l) => l,
            None => { eprintln!("[parse_opgg_text] gruppo extra idx={}", idx); continue; }
        };

        let pattern = "Top(";
        let mut search = *group;
        let mut count = 0usize;

        while let Some(start_idx) = search.find(pattern) {
            let rest = &search[start_idx + pattern.len()..];

            // Trova la ')' di chiusura del record contando le parentesi annidate
            let mut pd = 1i32;
            let mut end = rest.len();
            for (i, ch) in rest.char_indices() {
                match ch {
                    '(' => pd += 1,
                    ')' => {
                        pd -= 1;
                        if pd == 0 { end = i; break; }
                    }
                    _ => {}
                }
            }

            let inner = &rest[..end];
            let values = split_csv(inner);

            if values.len() >= 11 {
                let champion  = values[0].trim().trim_matches('"').to_string();
                let win_rate  = values[5].trim().parse::<f64>().unwrap_or(0.5);
                let pick_rate = values[6].trim().parse::<f64>().unwrap_or(0.0);
                let ban_rate  = values[8].trim().parse::<f64>().unwrap_or(0.0);
                let kda       = values[9].trim().parse::<f64>().unwrap_or(0.0);
                let tier      = values[10].trim().parse::<u64>().unwrap_or(5);
                let play      = values[2].trim().parse::<u64>().unwrap_or(0);
                let win       = values[3].trim().parse::<u64>().unwrap_or(0);

                all_champions.push(json!({
                    "champion_id": champion,
                    "position":    lane,
                    "win_rate":    win_rate,
                    "pick_rate":   pick_rate,
                    "ban_rate":    ban_rate,
                    "kda":         kda,
                    "tier":        tier,
                    "games":       play,
                    "wins":        win,
                }));
                count += 1;
            }

            // Avanza oltre questo record
            search = &rest[end + 1..];
        }

        eprintln!("[parse_opgg_text] Lane {}: {} campioni", lane, count);
    }

    eprintln!("[parse_opgg_text] Totale campioni: {}", all_champions.len());
    json!({ "data": all_champions })
}

/// Fallback: usato solo se "Positions(" non viene trovato (formato inatteso)
fn parse_opgg_text_fallback(text: &str) -> Value {
    eprintln!("[parse_opgg_text_fallback] Tentativo fallback...");
    // Cerca i 5 blocchi in base alla posizione dei separatori ],[ nel testo
    // Trova tutti i Top( e assegna le lane in base all'ordine dei gruppi separati da ],[
    let mut all_champions: Vec<Value> = Vec::new();
    let lane_order = ["top", "mid", "jungle", "adc", "support"];

    // Trova gli offset dei separatori ],[ di primo livello dopo "Positions(["
    let base = match text.find("Positions([") {
        Some(p) => p + "Positions([".len(),
        None    => 0,
    };

    // Raccoglie i byte-offset di ogni "],["
    let mut group_starts: Vec<usize> = vec![base];
    let sub = &text[base..];
    let chars: Vec<(usize, char)> = sub.char_indices().collect();
    let mut depth = 0i32;
    let mut i = 0;
    while i < chars.len() {
        let (bi, ch) = chars[i];
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            ']' if depth == 0 => {
                if i + 2 < chars.len() && chars[i+1].1 == ',' && chars[i+2].1 == '[' {
                    group_starts.push(base + chars[i+3].0);
                    i += 2;
                }
            }
            _ => {}
        }
        i += 1;
    }

    for (idx, &gs) in group_starts.iter().enumerate() {
        let lane = match lane_order.get(idx) { Some(&l) => l, None => break };
        let ge   = group_starts.get(idx + 1).copied().unwrap_or(text.len());
        let section = &text[gs..ge];

        let mut search = section;
        while let Some(si) = search.find("Top(") {
            let rest = &search[si + 4..];
            let mut pd = 1i32;
            let mut end = rest.len();
            for (i, ch) in rest.char_indices() {
                match ch { '(' => pd += 1, ')' => { pd -= 1; if pd == 0 { end = i; break; } } _ => {} }
            }
            let values = split_csv(&rest[..end]);
            if values.len() >= 11 {
                let champion  = values[0].trim().trim_matches('"').to_string();
                let win_rate  = values[5].trim().parse::<f64>().unwrap_or(0.5);
                let pick_rate = values[6].trim().parse::<f64>().unwrap_or(0.0);
                let ban_rate  = values[8].trim().parse::<f64>().unwrap_or(0.0);
                let kda       = values[9].trim().parse::<f64>().unwrap_or(0.0);
                let tier      = values[10].trim().parse::<u64>().unwrap_or(5);
                let play      = values[2].trim().parse::<u64>().unwrap_or(0);
                let win       = values[3].trim().parse::<u64>().unwrap_or(0);
                all_champions.push(json!({
                    "champion_id": champion, "position": lane,
                    "win_rate": win_rate, "pick_rate": pick_rate, "ban_rate": ban_rate,
                    "kda": kda, "tier": tier, "games": play, "wins": win,
                }));
            }
            search = &rest[end + 1..];
        }
    }

    eprintln!("[parse_opgg_text_fallback] Totale: {}", all_champions.len());
    json!({ "data": all_champions })
}

/// Splitta CSV rispettando le stringhe tra virgolette
fn split_csv(s: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for ch in s.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                result.push(current.clone());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() { result.push(current); }
    result
}

/// Alias per compatibilità con il frontend che chiama "get_rlp_matches"
#[tauri::command]
async fn get_rlp_matches(summoner_id: String, region: String, limit: u32) -> Result<Value, String> {
    get_opgg_matches(summoner_id, region, limit).await
}

#[tauri::command]
async fn get_opgg_matches(summoner_id: String, region: String, limit: u32) -> Result<Value, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().unwrap();

    let result = call_opgg_tool("lol_list_summoner_matches", json!({
        "summoner_id": summoner_id,
        "region": region,
        "limit": limit,
        "desired_output_fields": [
            "data[].{game_id,created_at,is_win,champion_id,position,kill,death,assist,cs,game_length_second}",
            "data[].items[].id",
            "data[].participants[].{summoner_id,champion_id,position,kill,death,assist,is_win,team_key}"
        ]
    }), &client).await?;

    // Normalizza in un array di match compatibile con il frontend
    let empty = vec![];
    let matches_raw = result["data"].as_array().unwrap_or(&empty);

    let matches: Vec<Value> = matches_raw.iter().map(|m| {
        let participants: Vec<Value> = m["participants"].as_array().unwrap_or(&empty).iter().map(|p| {
            let team_key = p["team_key"].as_str().unwrap_or("blue");
            let raw_id = p["summoner_id"].as_str().unwrap_or("");
            // OP.GG restituisce summoner_id come "Nome#TAG" — splittiamo
            let (game_name, tag_line) = if let Some(idx) = raw_id.find('#') {
                (&raw_id[..idx], &raw_id[idx+1..])
            } else {
                (raw_id, "EUW")
            };
            json!({
                "teamId": if team_key == "blue" { 100 } else { 200 },
                "summonerName": raw_id,
                "riotIdGameName": game_name,
                "riotIdTagline": tag_line,
                "championName": p["champion_id"].as_str().unwrap_or(""),
                "kills": p["kill"].as_u64().unwrap_or(0),
                "deaths": p["death"].as_u64().unwrap_or(0),
                "assists": p["assist"].as_u64().unwrap_or(0),
                "win": p["is_win"].as_bool().unwrap_or(false),
                "isMe": raw_id == summoner_id.as_str()
            })
        }).collect();

        // Determina teamId del giocatore cercato
        let my_team_id: u64 = participants.iter()
            .find(|p| p["isMe"].as_bool().unwrap_or(false))
            .and_then(|p| p["teamId"].as_u64())
            .unwrap_or(100);

        let items: Vec<Value> = m["items"].as_array().unwrap_or(&empty).iter()
            .map(|i| json!(i["id"].as_u64().unwrap_or(0)))
            .collect();

        json!({
            "matchId": m["game_id"],
            "win": m["is_win"].as_bool().unwrap_or(false),
            "championName": m["champion_id"].as_str().unwrap_or(""),
            "position": m["position"].as_str().unwrap_or(""),
            "kills": m["kill"].as_u64().unwrap_or(0),
            "deaths": m["death"].as_u64().unwrap_or(0),
            "assists": m["assist"].as_u64().unwrap_or(0),
            "totalMinionsKilled": m["cs"].as_u64().unwrap_or(0),
            "gameDuration": m["game_length_second"].as_u64().unwrap_or(0),
            "gameCreation": m["created_at"],
            "items": items,
            "teamId": my_team_id,
            "participants": participants
        })
    }).collect();

    eprintln!("[get_opgg_matches] {} partite restituite per {}", matches.len(), summoner_id);

    // Filtra solo partite Season 2026 — created_at è ISO string "2026-01-15T..."
    let season_start = chrono::DateTime::parse_from_rfc3339("2026-01-08T00:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);

    let matches: Vec<Value> = matches.into_iter().filter(|m| {
        let created_at = m["gameCreation"].as_str().unwrap_or("");
        if created_at.is_empty() { return true; } // se mancante, teniamo
        chrono::DateTime::parse_from_rfc3339(created_at)
            .map(|dt| dt.with_timezone(&chrono::Utc) >= season_start)
            .unwrap_or(true)
    }).collect();

    eprintln!("[get_opgg_matches] {} partite dopo filtro Season 2026", matches.len());
    Ok(json!(matches))
}

#[tauri::command]
async fn get_tier_list() -> Result<String, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().unwrap();

    let body = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": "lol_list_lane_meta_champions", "arguments": {
            "region": "euw",
            "lang": "en_US",
            "position_filter": "all"
        }}
    });

    let res = client.post(OPGG_MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .json(&body).send().await.map_err(|e| e.to_string())?;

    let raw_text = res.text().await.map_err(|e| e.to_string())?;

    eprintln!("[get_tier_list] Risposta ricevuta, lunghezza: {} bytes", raw_text.len());
    eprintln!("[get_tier_list] Primi 400 chars: {}", &raw_text[..raw_text.len().min(400)]);

    // Scansiona ogni riga della risposta SSE/JSON
    for line in raw_text.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }

        // Rimuovi il prefisso "data: " se presente
        let data_str = line.strip_prefix("data: ").unwrap_or(line);

        if let Ok(parsed) = serde_json::from_str::<Value>(data_str) {
            // Struttura principale: result.content[].text
            if let Some(content) = parsed["result"]["content"].as_array() {
                for item in content {
                    if item["type"] == "text" {
                        if let Some(text_val) = item["text"].as_str() {
                            eprintln!("[get_tier_list] Trovato testo via result.content, len={}", text_val.len());
                            return Ok(text_val.to_string());
                        }
                    }
                }
            }
            // Struttura alternativa: params.content[].text (alcuni server MCP)
            if let Some(content) = parsed["params"]["content"].as_array() {
                for item in content {
                    if item["type"] == "text" {
                        if let Some(text_val) = item["text"].as_str() {
                            eprintln!("[get_tier_list] Trovato testo via params.content, len={}", text_val.len());
                            return Ok(text_val.to_string());
                        }
                    }
                }
            }
            // Struttura alternativa 2: content[].text diretto
            if let Some(content) = parsed["content"].as_array() {
                for item in content {
                    if item["type"] == "text" {
                        if let Some(text_val) = item["text"].as_str() {
                            eprintln!("[get_tier_list] Trovato testo via content, len={}", text_val.len());
                            return Ok(text_val.to_string());
                        }
                    }
                }
            }
        }
    }

    // Log della risposta completa per debug
    eprintln!("[get_tier_list] ERRORE - risposta completa:\n{}", raw_text);
    Err(format!(
        "Nessun testo trovato nella risposta OP.GG. Primi 400 chars: {}",
        &raw_text[..raw_text.len().min(400)]
    ))
}

// ── Live Game (Spectator-V5 + League-V4 rank in parallelo) ───────────────────

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

/// Chiama la Live Client Data API locale (porta 2999) — disponibile SOLO quando
/// sei personalmente in partita. Non richiede API key.
async fn fetch_live_client_data(client: &Client) -> Option<Value> {
    // /liveclientdata/allgamedata contiene tutto: giocatori, score, eventi
    let url = "https://127.0.0.1:2999/liveclientdata/allgamedata";
    let res = client.get(url).send().await.ok()?;
    if !res.status().is_success() { return None; }
    let data: Value = res.json().await.ok()?;
    // Se non ha "allPlayers" non è una risposta valida
    if data["allPlayers"].as_array().is_none() { return None; }
    Some(data)
}

/// Normalizza la risposta della Live Client Data API nel formato interno.
fn build_live_game_from_lcd(lcd: &Value, my_summoner_name: &str) -> Value {
    let game_data  = &lcd["gameData"];
    let queue_id   = game_data["gameMode"].as_str().unwrap_or("");
    let queue_type = match queue_id {
        "CLASSIC"  => "Normal/Ranked",
        "ARAM"     => "ARAM",
        "TUTORIAL" => "Tutorial",
        _          => queue_id,
    }.to_string();

    let game_time_f = game_data["gameTime"].as_f64().unwrap_or(0.0);
    let game_length = game_time_f as u64;

    let empty = vec![];
    let all_players = lcd["allPlayers"].as_array().unwrap_or(&empty);

    // Identifica il team del giocatore corrente
    let my_team = all_players.iter()
        .find(|p| {
            let name = p["summonerName"].as_str().unwrap_or("");
            name.eq_ignore_ascii_case(my_summoner_name) ||
            name.eq_ignore_ascii_case(my_summoner_name.split('#').next().unwrap_or(""))
        })
        .and_then(|p| p["team"].as_str())
        .unwrap_or("ORDER");

    let players: Vec<Value> = all_players.iter().map(|p| {
        let name      = p["summonerName"].as_str().unwrap_or("").to_string();
        let champ     = p["championName"].as_str().unwrap_or("").to_string();
        let team_str  = p["team"].as_str().unwrap_or("ORDER");
        let is_me     = name.eq_ignore_ascii_case(my_summoner_name)
            || name.eq_ignore_ascii_case(my_summoner_name.split('#').next().unwrap_or(""));

        // Spell mapping LCD → DDragon
        fn map_spell(s: &str) -> &str {
            match s {
                "SummonerFlash"     => "SummonerFlash",
                "SummonerDot"       => "SummonerDot",
                "SummonerTeleport"  => "SummonerTeleport",
                "SummonerBarrier"   => "SummonerBarrier",
                "SummonerExhaust"   => "SummonerExhaust",
                "SummonerHaste"     => "SummonerHaste",
                "SummonerHeal"      => "SummonerHeal",
                "SummonerBoost"     => "SummonerBoost",
                "SummonerSmite"     => "SummonerSmite",
                "SummonerMana"      => "SummonerMana",
                "SummonerSnowball"  => "SummonerSnowball",
                other               => other,
            }
        }

        let spell1 = p["summonerSpells"]["summonerSpellOne"]["displayName"]
            .as_str().unwrap_or("SummonerFlash");
        let spell2 = p["summonerSpells"]["summonerSpellTwo"]["displayName"]
            .as_str().unwrap_or("SummonerFlash");

        json!({
            "summoner_name":   name,
            "puuid":           "",
            "champion_id":     0,
            "champion_name":   champ,
            "profile_icon_id": 0,
            "team":            team_str,
            "spell1":          map_spell(spell1),
            "spell2":          map_spell(spell2),
            "tier":            "",
            "rank":            "",
            "lp":              0,
            "is_me":           is_me,
        })
    }).collect();

    // Ban dalla LCD (non sempre disponibili)
    let bans_blue = lcd["teamData"]["bannedChampions"].as_array()
        .unwrap_or(&empty).iter()
        .map(|b| json!({
            "champion_id": b["championId"].as_i64().unwrap_or(-1),
            "team": "ORDER",
            "pick_turn": b["pickTurn"].as_u64().unwrap_or(0),
        })).collect::<Vec<_>>();

    json!({
        "in_game":          true,
        "game_time":        game_length,
        "game_start_time":  0,
        "queue_type":       queue_type,
        "game_id":          0,
        "banned_champions": bans_blue,
        "players":          players,
        "duo_pairs":        [],
        "_source":          "lcd",
    })
}

/// Chiama Spectator-V5. L'endpoint /by-summoner/ in V5 accetta il PUUID (non più il summoner ID cifrato).
async fn fetch_spectator(puuid: &str, client: &Client) -> Option<Value> {
    let url = format!(
        "https://euw1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/{}",
        puuid
    );
    let res = match client.get(&url).header("X-Riot-Token", riot_api_key()).send().await {
        Ok(r)  => r,
        Err(e) => { eprintln!("[Spectator] Errore rete: {}", e); return None; }
    };
    let code = res.status().as_u16();
    eprintln!("[Spectator] HTTP {} per puuid={}", code, &puuid[..puuid.len().min(20)]);
    if code == 404 || code == 403 || code == 400 { return None; }
    if code != 200 {
        let body = res.text().await.unwrap_or_default();
        eprintln!("[Spectator] Risposta non-200: {}", &body[..body.len().min(300)]);
        return None;
    }
    let data: Value = match res.json().await {
        Ok(v)  => v,
        Err(e) => { eprintln!("[Spectator] JSON parse error: {}", e); return None; }
    };
    if data.get("status").is_some() {
        eprintln!("[Spectator] Risposta errore Riot: {:?}", data["status"]);
        return None;
    }
    eprintln!("[Spectator] OK — gameId={}, participants={}",
        data["gameId"], data["participants"].as_array().map(|a| a.len()).unwrap_or(0));
    Some(data)
}

/// Recupera ranked SoloQ (fallback Flex) per un puuid via League-V4.
async fn fetch_ranked_entry(puuid: String, client: Client) -> (String, String, i64) {
    if puuid.is_empty() { return (String::new(), String::new(), 0); }
    let url = format!(
        "https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/{}",
        puuid
    );
    let entries: Vec<Value> = match client.get(&url)
        .header("X-Riot-Token", riot_api_key())
        .send().await
    {
        Ok(r)  => r.json().await.unwrap_or_default(),
        Err(_) => vec![],
    };
    for queue in &["RANKED_SOLO_5x5", "RANKED_FLEX_SR"] {
        if let Some(e) = entries.iter().find(|e| e["queueType"].as_str() == Some(queue)) {
            let tier = e["tier"].as_str().unwrap_or("").to_uppercase();
            let rank = e["rank"].as_str().unwrap_or("").to_uppercase();
            let lp   = e["leaguePoints"].as_i64().unwrap_or(0);
            if !tier.is_empty() && tier != "NONE" {
                return (tier, rank, lp);
            }
        }
    }
    (String::new(), String::new(), 0)
}

/// Normalizza Spectator-V5 recuperando i rank in parallelo con tokio::spawn.
async fn build_live_game_response(raw: &Value, my_puuid: &str, client: &Client) -> Value {
    let queue_id   = raw["gameQueueConfigId"].as_u64().unwrap_or(0);
    let queue_type = match queue_id {
        420 => "Ranked Solo/Duo", 440 => "Ranked Flex",
        430 => "Normal Blind",    400 => "Normal Draft",
        450 => "ARAM",            _   => "Other",
    }.to_string();

    let game_length     = raw["gameLength"].as_u64().unwrap_or(0);
    let game_start_time = raw["gameStartTime"].as_i64().unwrap_or(0); // epoch ms

    // Ban: lista di { champion_id, team_id, pick_turn }
    let empty_arr = vec![];
    let banned: Vec<Value> = raw["bannedChampions"].as_array().unwrap_or(&empty_arr)
        .iter().map(|b| json!({
            "champion_id": b["championId"].as_i64().unwrap_or(-1),
            "team":        if b["teamId"].as_u64().unwrap_or(100) == 100 { "ORDER" } else { "CHAOS" },
            "pick_turn":   b["pickTurn"].as_u64().unwrap_or(0),
        })).collect();

    let participants = raw["participants"].as_array().unwrap_or(&empty_arr);

    // Lancia tutte le chiamate ranked in parallelo con tokio::spawn
    let handles: Vec<_> = participants.iter().map(|p| {
        let puuid  = p["puuid"].as_str().unwrap_or("").to_string();
        let client = client.clone();
        tokio::spawn(async move { fetch_ranked_entry(puuid, client).await })
    }).collect();

    let mut ranks: Vec<(String, String, i64)> = Vec::new();
    for h in handles {
        ranks.push(h.await.unwrap_or_default());
    }

    let players: Vec<Value> = participants.iter().zip(ranks.iter())
        .map(|(p, (tier, rank, lp))| {
            let champ_id      = p["championId"].as_u64().unwrap_or(0);
            let team_id       = p["teamId"].as_u64().unwrap_or(100);
            let puuid_p       = p["puuid"].as_str().unwrap_or("");
            let is_me         = !my_puuid.is_empty() && puuid_p == my_puuid;
            let profile_icon  = p["profileIconId"].as_u64().unwrap_or(0);
            let riot_id       = p["riotId"].as_str().unwrap_or("");
            let name          = if !riot_id.is_empty() {
                riot_id.to_string()
            } else {
                p["summonerName"].as_str().unwrap_or("").to_string()
            };
            json!({
                "summoner_name":   name,
                "puuid":           puuid_p,
                "champion_id":     champ_id,
                "champion_name":   "",
                "profile_icon_id": profile_icon,
                "team":            if team_id == 100 { "ORDER" } else { "CHAOS" },
                "spell1":          spell_id_to_ddragon(p["spell1Id"].as_u64().unwrap_or(0)),
                "spell2":          spell_id_to_ddragon(p["spell2Id"].as_u64().unwrap_or(0)),
                "tier":            tier,
                "rank":            rank,
                "lp":              lp,
                "is_me":           is_me,
            })
        })
        .collect();

    // ── Duo detection ────────────────────────────────────────────────────────
    // Controlla nelle recenti partite (Neon cache) chi appare spesso con "me"
    let mut duo_pairs: Vec<Value> = vec![];
    if !my_puuid.is_empty() {
        // Recupera match recenti del giocatore dalla cache Neon
        if let Some(pool) = get_pool().await {
            if let Ok(pg) = pool.get().await {
                // Trova le ultime 20 partite dove appare my_puuid
                if let Ok(rows) = pg.query(
                    "SELECT data::text FROM match_cache WHERE data::text LIKE $1 LIMIT 20",
                    &[&format!("%{}%", my_puuid)],
                ).await {
                    let mut coplay: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
                    for row in &rows {
                        let raw: String = row.get(0);
                        if let Ok(m) = serde_json::from_str::<Value>(&raw) {
                            let participants = m["info"]["participants"].as_array()
                                .cloned().unwrap_or_default();
                            let my_team = participants.iter()
                                .find(|p| p["puuid"].as_str() == Some(my_puuid))
                                .and_then(|p| p["teamId"].as_u64());
                            if let Some(tid) = my_team {
                                for p in &participants {
                                    let puuid = p["puuid"].as_str().unwrap_or("");
                                    if puuid != my_puuid && p["teamId"].as_u64() == Some(tid) {
                                        *coplay.entry(puuid.to_string()).or_insert(0) += 1;
                                    }
                                }
                            }
                        }
                    }
                    // Considera duo chi ha giocato >= 3 partite insieme
                    for (puuid, count) in &coplay {
                        if *count >= 3 {
                            duo_pairs.push(json!([my_puuid, puuid]));
                        }
                    }
                }
            }
        }
    }

    json!({
        "in_game":         true,
        "game_time":       game_length,
        "game_start_time": game_start_time,
        "queue_type":      queue_type,
        "game_id":         raw["gameId"],
        "banned_champions": banned,
        "players":         players,
        "duo_pairs":       duo_pairs,
    })
}

/// Live Game per il giocatore loggato: prova LCD (porta 2999) e Spectator V5 in parallelo,
/// usa il primo che risponde positivamente.
#[tauri::command]
async fn get_live_game() -> Result<Value, String> {
    let lock_path = get_lockfile_path().ok_or("CLIENT_CLOSED")?;
    let content   = fs::read_to_string(&lock_path).map_err(|_| "CLIENT_CLOSED")?;
    let parts: Vec<&str> = content.split(':').collect();
    if parts.len() < 4 { return Err("CLIENT_CLOSED".into()); }
    let port     = parts[2];
    let password = parts[3].trim_end_matches('\n').trim_end_matches('\r');
    let auth     = general_purpose::STANDARD.encode(format!("riot:{}", password));
    let client   = Client::builder().danger_accept_invalid_certs(true).build().unwrap();

    // Legge il nome summoner + puuid dal LCU
    let me: Value = client
        .get(&format!("https://127.0.0.1:{}/lol-summoner/v1/current-summoner", port))
        .header("Authorization", format!("Basic {}", auth))
        .send().await.map_err(|_| "CLIENT_CLOSED")?
        .json().await.unwrap_or(json!({}));

    let my_puuid         = me["puuid"].as_str().unwrap_or("").to_string();
    let my_summoner_name = me["gameName"].as_str().unwrap_or("").to_string();
    if my_puuid.is_empty() { return Err("CLIENT_CLOSED".into()); }

    // Prova LCD e Spectator in parallelo
    let client_lcd       = client.clone();
    let client_spectator = client.clone();
    let puuid_for_spec   = my_puuid.clone();
    let name_for_lcd     = my_summoner_name.clone();

    let lcd_handle = tokio::spawn(async move {
        fetch_live_client_data(&client_lcd).await
            .map(|lcd| build_live_game_from_lcd(&lcd, &name_for_lcd))
    });

    let spec_handle = tokio::spawn(async move {
        match fetch_spectator(&puuid_for_spec, &client_spectator).await {
            Some(raw) => Some(raw),
            None      => None,
        }
    });

    // Aspetta LCD per primo (risposta locale, ~1ms), poi Spectator
    let lcd_result = lcd_handle.await.unwrap_or(None);
    if let Some(mut resp) = lcd_result {
        eprintln!("[LiveGame] Fonte: LCD (porta 2999)");

        // Arricchisce con rank: usa i names che hanno il tag (#) per ricavare PUUID
        let players_snap = resp["players"].as_array().cloned().unwrap_or_default();
        let rank_handles: Vec<_> = players_snap.iter().map(|p| {
            let name    = p["summoner_name"].as_str().unwrap_or("").to_string();
            let client2 = client.clone();
            tokio::spawn(async move {
                let parts2: Vec<&str> = name.splitn(2, '#').collect();
                let puuid = if parts2.len() == 2 {
                    fetch_puuid(parts2[0], parts2[1], &client2).await.unwrap_or_default()
                } else { String::new() };
                if puuid.is_empty() { return (name, String::new(), String::new(), 0i64); }
                let (tier, rank, lp) = fetch_ranked_entry(puuid, client2).await;
                (name, tier, rank, lp)
            })
        }).collect();

        let mut rank_map: std::collections::HashMap<String, (String, String, i64)> = std::collections::HashMap::new();
        for h in rank_handles {
            if let Ok((name, tier, rank, lp)) = h.await {
                if !tier.is_empty() { rank_map.insert(name, (tier, rank, lp)); }
            }
        }
        if let Some(arr) = resp["players"].as_array_mut() {
            for p in arr.iter_mut() {
                let name = p["summoner_name"].as_str().unwrap_or("").to_string();
                if let Some((tier, rank, lp)) = rank_map.get(&name) {
                    p["tier"] = json!(tier);
                    p["rank"] = json!(rank);
                    p["lp"]   = json!(lp);
                }
            }
        }
        return Ok(resp);
    }

    // LCD non disponibile → aspetta Spectator
    eprintln!("[LiveGame] LCD non disponibile, uso Spectator V5");
    match spec_handle.await.unwrap_or(None) {
        None      => Ok(json!({ "in_game": false, "game_time": 0, "queue_type": "", "players": [] })),
        Some(raw) => Ok(build_live_game_response(&raw, &my_puuid, &client).await),
    }
}

/// Live Game per qualsiasi summoner (dalla tab profilo / ricerca).
/// Non può usare LCD (solo per il giocatore locale), usa Spectator V5.
#[tauri::command]
async fn check_live_game(puuid: String) -> Result<Value, String> {
    eprintln!("[check_live_game] Checking puuid={}", &puuid[..puuid.len().min(20)]);
    let client = Client::builder().danger_accept_invalid_certs(true).build().unwrap();
    match fetch_spectator(&puuid, &client).await {
        None      => Ok(json!({ "in_game": false, "game_time": 0, "queue_type": "", "players": [] })),
        Some(raw) => Ok(build_live_game_response(&raw, &puuid, &client).await),
    }
}


/// Recupera le maestrie del summoner tramite Riot API.
/// Accetta sia il puuid diretto che game_name+tag_line (separati da '#').
#[tauri::command]
async fn get_summoner_masteries(puuid: String) -> Result<Value, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap();

    let url = format!(
        "https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/{}/top?count=20",
        puuid
    );

    let res = client
        .get(&url)
        .header("X-Riot-Token", riot_api_key())
        .send().await
        .map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    if status == 404 { return Ok(json!([])); }
    if status != 200 {
        return Err(format!("Riot API errore {}", status));
    }

    let masteries: Value = res.json().await.map_err(|_| "Errore JSON masteries")?;
    Ok(masteries)
}

/// Recupera la timeline di un match per mostrare gli acquisti item per minuto.
#[tauri::command]
async fn get_match_timeline(match_id: String) -> Result<Value, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap();

    let url = format!(
        "https://europe.api.riotgames.com/lol/match/v5/matches/{}/timeline",
        match_id
    );

    for attempt in 0..3u32 {
        let res = client
            .get(&url)
            .header("X-Riot-Token", riot_api_key())
            .send().await
            .map_err(|e| e.to_string())?;

        let status = res.status().as_u16();
        if status == 429 {
            let wait = 2000 * (attempt + 1) as u64;
            tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
            continue;
        }
        if status != 200 {
            return Err(format!("Riot API timeline error {}", status));
        }
        let data: Value = res.json().await.map_err(|_| "Errore JSON timeline")?;
        return Ok(data);
    }
    Err("Timeline fetch fallita dopo 3 tentativi".into())
}

fn main() {

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_profiles, get_more_matches, search_summoner, get_opgg_data,
            get_champ_select_session, auto_import_build, list_opgg_tools,
            debug_champ_select_slot, get_tier_list, get_opgg_matches, get_rlp_matches,
            get_live_game, check_live_game, get_summoner_masteries, get_match_timeline
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}