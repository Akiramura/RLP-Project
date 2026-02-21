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

/// Legge RIOT_API_KEY dal .env (o variabile d'ambiente di sistema in produzione)
fn riot_api_key() -> String {
    std::env::var("RIOT_API_KEY").expect("RIOT_API_KEY non trovata — controlla il file .env")
}

// OnceCell stores Option<Pool> so we never retry a failed init
static POOL: OnceCell<Option<Pool>> = OnceCell::const_new();

async fn get_pool() -> Option<&'static Pool> {
    POOL.get_or_init(|| async {
        let mut cfg = Config::new();
        cfg.host     = Some(std::env::var("NEON_HOST").expect("NEON_HOST non trovata nel .env"));
        cfg.port     = Some(std::env::var("NEON_PORT").unwrap_or_else(|_| "5432".into()).parse::<u16>().unwrap_or(5432));
        cfg.dbname   = Some(std::env::var("NEON_DB").expect("NEON_DB non trovata nel .env"));
        cfg.user     = Some(std::env::var("NEON_USER").expect("NEON_USER non trovata nel .env"));
        cfg.password = Some(std::env::var("NEON_PASSWORD").expect("NEON_PASSWORD non trovata nel .env"));
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
    let res  = client.get(&url).header("X-Riot-Token", riot_api_key()).send().await.ok()?;
    let data: Value = res.json().await.ok()?;
    data["puuid"].as_str().map(|s| s.to_string())
}

async fn fetch_match_ids(puuid: &str, start: u32, count: u32, client: &Client) -> Vec<String> {
    let url = format!(
        "https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/{}/ids?start={}&count={}",
        puuid, start, count
    );
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
    if let Some(cached) = db_get_match(match_id).await {
        println!("✓ Cache hit Neon: {}", match_id);
        return cached;
    }
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
    Err(format!("Risposta OP.GG non valida (primi 800 car): {}", &text[..800.min(text.len())]))
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


/// Recupera la match history di un summoner tramite OP.GG MCP.
/// Molto più veloce della Riot API: una sola chiamata invece di N+1.
/// Restituisce un array di match già parsati pronti per il frontend.
#[tauri::command]
async fn get_opgg_matches(summoner_id: String, region: String, limit: Option<u32>) -> Result<Value, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build().unwrap();

    let limit = limit.unwrap_or(20);
    let region = if region.is_empty() { "euw".to_string() } else { region.to_lowercase() };

    eprintln!("[get_opgg_matches] summoner={} region={} limit={}", summoner_id, region, limit);

    let result = call_opgg_tool("lol_list_summoner_matches", json!({
        "summoner_id": summoner_id,
        "region": region,
        "game_type": "total",
        "limit": limit,
        "desired_output_fields": [
            "data[].{game_id,champion_id,position,is_win,kill,death,assist,cs,cs_per_min,gold,game_length_second,created_at}",
            "data[].tier_info.{tier,division,lp}",
            "data[].items[].id",
            "data[].summoner_spells[].id"
        ]
    }), &client).await?;

    eprintln!("[get_opgg_matches] risposta grezza: {}", result.to_string().get(..300.min(result.to_string().len())).unwrap_or(""));

    // La risposta ha struttura: { "data": [...] } oppure è già un array
    let matches_arr = if let Some(arr) = result["data"].as_array() {
        arr.clone()
    } else if result.is_array() {
        result.as_array().unwrap().clone()
    } else {
        return Err(format!("Struttura risposta OP.GG inattesa: {}", &result.to_string()[..200.min(result.to_string().len())]));
    };

    // Normalizza ogni match nel formato atteso dal frontend
    let normalized: Vec<Value> = matches_arr.iter().map(|m| {
        let items: Vec<Value> = m["items"].as_array()
            .map(|arr| arr.iter().filter_map(|i| i["id"].as_u64()).map(|id| json!(id)).collect())
            .unwrap_or_default();

        let spells: Vec<Value> = m["summoner_spells"].as_array()
            .map(|arr| arr.iter().filter_map(|s| s["id"].as_u64()).map(|id| json!(id)).collect())
            .unwrap_or_default();

        let game_id = m["game_id"].as_str().unwrap_or("").to_string();
        let champ   = m["champion_id"].as_str().unwrap_or("Unknown").to_string();
        let pos     = m["position"].as_str().unwrap_or("").to_string();
        let win     = m["is_win"].as_bool().unwrap_or(false);
        let kills   = m["kill"].as_u64().unwrap_or(0);
        let deaths  = m["death"].as_u64().unwrap_or(0);
        let assists = m["assist"].as_u64().unwrap_or(0);
        let cs      = m["cs"].as_u64().unwrap_or(0);
        let cs_pm   = m["cs_per_min"].as_f64().unwrap_or(0.0);
        let gold    = m["gold"].as_u64().unwrap_or(0);
        let duration = m["game_length_second"].as_u64().unwrap_or(0);
        let created = m["created_at"].as_str().unwrap_or("").to_string();

        let tier = m.pointer("/tier_info/tier").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let div  = m.pointer("/tier_info/division").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let lp   = m.pointer("/tier_info/lp").and_then(|v| v.as_u64()).unwrap_or(0);

        json!({
            "matchId":            game_id,
            "championName":       champ,
            "position":           pos,
            "win":                win,
            "kills":              kills,
            "deaths":             deaths,
            "assists":            assists,
            "totalMinionsKilled": cs,
            "csPerMin":           cs_pm,
            "goldEarned":         gold,
            "gameDuration":       duration,
            "gameCreation":       created,
            "items":              items,
            "summonerSpells":     spells,
            "tier":               tier,
            "division":           div,
            "lp":                 lp,
            "queueLabel":         "Ranked",
            // Slot singoli per compatibilità con il vecchio formato
            "item0": items.get(0).and_then(|v| v.as_u64()).unwrap_or(0),
            "item1": items.get(1).and_then(|v| v.as_u64()).unwrap_or(0),
            "item2": items.get(2).and_then(|v| v.as_u64()).unwrap_or(0),
            "item3": items.get(3).and_then(|v| v.as_u64()).unwrap_or(0),
            "item4": items.get(4).and_then(|v| v.as_u64()).unwrap_or(0),
            "item5": items.get(5).and_then(|v| v.as_u64()).unwrap_or(0),
            "item6": items.get(6).and_then(|v| v.as_u64()).unwrap_or(0),
        })
    }).collect();

    eprintln!("[get_opgg_matches] {} partite normalizzate", normalized.len());
    Ok(json!(normalized))
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

fn main() {
    // Carica il file .env (in sviluppo). In produzione usa variabili d'ambiente di sistema.
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_profiles, get_more_matches, search_summoner, get_opgg_data,
            get_champ_select_session, auto_import_build, list_opgg_tools,
            debug_champ_select_slot, get_tier_list, get_opgg_matches
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}