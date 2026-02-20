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
// ────────────────────────────────────────────────────────────────────────────

mod champ_select;
use champ_select::{get_champ_select_session, auto_import_build, debug_champ_select_slot};

const RIOT_API_KEY: &str = "RGAPI-f074c374-0fed-4612-a46b-0d0c18ab76ba";
const OPGG_MCP_URL: &str = "https://mcp-api.op.gg/mcp";

// OnceCell stores Option<Pool> so we never retry a failed init
static POOL: OnceCell<Option<Pool>> = OnceCell::const_new();

async fn get_pool() -> Option<&'static Pool> {
    POOL.get_or_init(|| async {
        let mut cfg = Config::new();
        cfg.host     = Some("ep-muddy-voice-als8bfl8-pooler.c-3.eu-central-1.aws.neon.tech".to_string());
        cfg.port     = Some(5432);
        cfg.dbname   = Some("neondb".to_string());
        cfg.user     = Some("neondb_owner".to_string());
        cfg.password = Some("npg_iGh6YXECB7ML".to_string());
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

    Some(json!({
        "puuid": puuid,
        "profile": profile,
        "ranked_entries": ranked_entries,
        "matches": matches,
        "_from_cache": true
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

// ── Helpers ──────────────────────────────────────────────────────────────────

fn get_lockfile_path() -> PathBuf {
    PathBuf::from(r"C:\Riot Games\League of Legends\lockfile")
}

fn get_cache_path(handle: &AppHandle) -> PathBuf {
    handle.path().app_cache_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("cache.json")
}

async fn fetch_puuid(game_name: &str, tag_line: &str, client: &Client) -> Option<String> {
    let url = format!(
        "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{}/{}",
        game_name, tag_line
    );
    let res  = client.get(&url).header("X-Riot-Token", RIOT_API_KEY).send().await.ok()?;
    let data: Value = res.json().await.ok()?;
    data["puuid"].as_str().map(|s| s.to_string())
}

async fn fetch_match_ids(puuid: &str, start: u32, count: u32, client: &Client) -> Vec<String> {
    let url = format!(
        "https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/{}/ids?start={}&count={}",
        puuid, start, count
    );
    for attempt in 0..3u32 {
        match client.get(&url).header("X-Riot-Token", RIOT_API_KEY).send().await {
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
    if let Some(cached) = db_get_match(match_id).await {
        println!("✓ Cache hit Neon: {}", match_id);
        return cached;
    }
    let url = format!("https://europe.api.riotgames.com/lol/match/v5/matches/{}", match_id);
    for attempt in 0..3u32 {
        match client.get(&url).header("X-Riot-Token", RIOT_API_KEY).send().await {
            Ok(res) => {
                if res.status().as_u16() == 429 {
                    let wait = 2000 * (attempt + 1) as u64;
                    println!("Rate limit fetch_match_detail {}, attendo {}ms...", match_id, wait);
                    tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
                    continue;
                }
                let data = res.json::<Value>().await.unwrap_or(json!({}));
                if data.get("metadata").is_some() {
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
    Err(format!("Risposta OP.GG non valida: {}", &text[..200.min(text.len())]))
}

// ── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn get_profiles(handle: AppHandle) -> Result<Value, String> {
    let lock_path = get_lockfile_path();
    let cache_p   = get_cache_path(&handle);

    let cached_data: Option<Value> = fs::read_to_string(&cache_p).ok()
        .and_then(|s| serde_json::from_str(&s).ok());

    if !lock_path.exists() {
        return cached_data.ok_or("CLIENT_CLOSED".into());
    }

    let content  = fs::read_to_string(lock_path).map_err(|_| "Errore lockfile")?;
    let parts: Vec<&str> = content.split(':').collect();
    let port     = parts[2];
    let password = parts[3];
    let auth     = general_purpose::STANDARD.encode(format!("riot:{}", password));

    let client = Client::builder().danger_accept_invalid_certs(true).build().unwrap();

    let current_profile: Value = client
        .get(&format!("https://127.0.0.1:{}/lol-summoner/v1/current-summoner", port))
        .header("Authorization", format!("Basic {}", auth))
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|_| "Errore JSON profilo")?;

    let game_name = current_profile["gameName"].as_str().unwrap_or("").to_string();
    let tag_line  = current_profile["tagLine"].as_str().unwrap_or("").to_string();
    if game_name.is_empty() || tag_line.is_empty() {
        return Err("Impossibile leggere gameName/tagLine dal client".into());
    }

    let puuid = fetch_puuid(&game_name, &tag_line, &client).await
        .ok_or("Impossibile recuperare PUUID da Riot API")?;

    if let Some(cache) = &cached_data {
        let cached_puuid      = cache["puuid"].as_str().unwrap_or("");
        let matches_are_objects = cache["matches"].as_array()
            .and_then(|arr| arr.first()).map(|f| f.is_object()).unwrap_or(false);
        if cached_puuid == puuid && !puuid.is_empty() && matches_are_objects {
            println!("Cache locale valida.");
            return Ok(cache.clone());
        }
    }

    let ranked: Value = client
        .get(&format!("https://127.0.0.1:{}/lol-ranked/v1/current-ranked-stats", port))
        .header("Authorization", format!("Basic {}", auth))
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|_| "Errore JSON Rank")?;

    let match_ids = fetch_match_ids(&puuid, 0, 10, &client).await;
    let mut match_details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        match_details.push(fetch_match_detail(id, &client).await);
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
    let match_ids = fetch_match_ids(&puuid, start, 5, &client).await;
    let mut details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        println!("Fetching extra match: {}", id);
        details.push(fetch_match_detail(id, &client).await);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
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
        .header("X-Riot-Token", RIOT_API_KEY)
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|_| "Errore JSON account")?;

    let ranked_text = client
        .get(&format!("https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/{}", puuid))
        .header("X-Riot-Token", RIOT_API_KEY)
        .send().await.map_err(|e| e.to_string())?
        .text().await.unwrap_or_default();
    let ranked_entries: Value = serde_json::from_str(&ranked_text).unwrap_or(json!([]));

    let summoner: Value = client
        .get(&format!("https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{}", puuid))
        .header("X-Riot-Token", RIOT_API_KEY)
        .send().await.map_err(|e| e.to_string())?
        .json().await.unwrap_or(json!({}));

    let match_ids = fetch_match_ids(&puuid, 0, 10, &client).await;
    let mut match_details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        match_details.push(fetch_match_detail(id, &client).await);
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_profiles, get_more_matches, search_summoner, get_opgg_data,
            get_champ_select_session, auto_import_build, list_opgg_tools,
            debug_champ_select_slot  // ← FIX: aggiunto comando mancante
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}