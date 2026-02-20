#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{fs, path::PathBuf};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use base64::{engine::general_purpose, Engine as _};
use reqwest::Client;

const RIOT_API_KEY: &str = "RGAPI-1c100836-5686-499d-85c2-24205bb7db1c";
const OPGG_MCP_URL: &str = "https://mcp-api.op.gg/mcp";

fn get_lockfile_path() -> PathBuf {
    PathBuf::from(r"C:\Riot Games\League of Legends\lockfile")
}

fn get_cache_path(handle: &AppHandle) -> PathBuf {
    handle
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
        .join("cache.json")
}

async fn fetch_puuid(game_name: &str, tag_line: &str, client: &Client) -> Option<String> {
    let url = format!(
        "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{}/{}",
        game_name, tag_line
    );
    let res = client
        .get(&url)
        .header("X-Riot-Token", RIOT_API_KEY)
        .send()
        .await
        .ok()?;
    let data: Value = res.json().await.ok()?;
    data["puuid"].as_str().map(|s| s.to_string())
}

async fn fetch_match_ids(puuid: &str, start: u32, count: u32, client: &Client) -> Vec<String> {
    let url = format!(
        "https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/{}/ids?start={}&count={}",
        puuid, start, count
    );
    match client
        .get(&url)
        .header("X-Riot-Token", RIOT_API_KEY)
        .send()
        .await
    {
        Ok(res) => res.json::<Vec<String>>().await.unwrap_or_default(),
        Err(_) => vec![],
    }
}

async fn fetch_match_detail(match_id: &str, client: &Client) -> Value {
    let url = format!(
        "https://europe.api.riotgames.com/lol/match/v5/matches/{}",
        match_id
    );
    match client
        .get(&url)
        .header("X-Riot-Token", RIOT_API_KEY)
        .send()
        .await
    {
        Ok(res) => res.json::<Value>().await.unwrap_or(json!({})),
        Err(_) => json!({}),
    }
}

// Chiama un tool del server MCP di OP.GG
async fn call_opgg_tool(tool_name: &str, arguments: Value, client: &Client) -> Result<Value, String> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments
        }
    });

    let res = client
        .post(OPGG_MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = res.text().await.map_err(|e| e.to_string())?;

    // Il server MCP risponde con SSE (text/event-stream), parsechiamo il JSON dalle righe "data:"
    for line in text.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                // Estrai il contenuto dal formato MCP
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

#[tauri::command]
async fn get_profiles(handle: AppHandle) -> Result<Value, String> {
    let lock_path = get_lockfile_path();
    let cache_p = get_cache_path(&handle);

    let cached_data: Option<Value> = fs::read_to_string(&cache_p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());

    if !lock_path.exists() {
        return cached_data.ok_or("CLIENT_CLOSED".into());
    }

    let content = fs::read_to_string(lock_path).map_err(|_| "Errore lockfile")?;
    let parts: Vec<&str> = content.split(':').collect();
    let port = parts[2];
    let password = parts[3];
    let auth = general_purpose::STANDARD.encode(format!("riot:{}", password));

    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .unwrap();

    let profile_url = format!("https://127.0.0.1:{}/lol-summoner/v1/current-summoner", port);
    let current_profile: Value = client
        .get(&profile_url)
        .header("Authorization", format!("Basic {}", auth))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|_| "Errore JSON profilo")?;

    let game_name = current_profile["gameName"].as_str().unwrap_or("").to_string();
    let tag_line = current_profile["tagLine"].as_str().unwrap_or("").to_string();

    if game_name.is_empty() || tag_line.is_empty() {
        return Err("Impossibile leggere gameName/tagLine dal client".into());
    }

    let puuid = fetch_puuid(&game_name, &tag_line, &client)
        .await
        .ok_or("Impossibile recuperare PUUID da Riot API")?;

    if let Some(cache) = &cached_data {
        let cached_puuid = cache["puuid"].as_str().unwrap_or("");
        let matches_are_objects = cache["matches"]
            .as_array()
            .and_then(|arr| arr.first())
            .map(|first| first.is_object())
            .unwrap_or(false);

        if cached_puuid == puuid && !puuid.is_empty() && matches_are_objects {
            println!("Cache valida. Ritorno dati cached.");
            return Ok(cache.clone());
        }
    }

    println!("Nuovo account o cache assente. Aggiorno dati...");

    let ranked_url = format!("https://127.0.0.1:{}/lol-ranked/v1/current-ranked-stats", port);
    let ranked: Value = client
        .get(&ranked_url)
        .header("Authorization", format!("Basic {}", auth))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|_| "Errore JSON Rank")?;

    let match_ids = fetch_match_ids(&puuid, 0, 10, &client).await;
    let mut match_details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        println!("Fetching match: {}", id);
        let detail = fetch_match_detail(id, &client).await;
        match_details.push(detail);
    }

    let final_data = json!({
        "puuid": puuid,
        "profile": current_profile,
        "ranked": ranked,
        "matches": match_details,
        "last_update": chrono::Utc::now().to_rfc3339()
    });

    let _ = fs::write(cache_p, final_data.to_string());
    Ok(final_data)
}

#[tauri::command]
async fn get_more_matches(puuid: String, start: u32) -> Result<Value, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .unwrap();

    let match_ids = fetch_match_ids(&puuid, start, 5, &client).await;
    let mut details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        println!("Fetching extra match: {}", id);
        let detail = fetch_match_detail(id, &client).await;
        details.push(detail);
    }

    Ok(json!(details))
}

#[tauri::command]
async fn search_summoner(game_name: String, tag_line: String) -> Result<Value, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .unwrap();

    let puuid = fetch_puuid(&game_name, &tag_line, &client)
        .await
        .ok_or("Summoner non trovato. Controlla nome e tag.")?;

    let account_url = format!(
        "https://europe.api.riotgames.com/riot/account/v1/accounts/by-puuid/{}",
        puuid
    );
    let account: Value = client
        .get(&account_url)
        .header("X-Riot-Token", RIOT_API_KEY)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|_| "Errore JSON account")?;

    // Riot ha deprecato "id" in /summoner/v4/summoners/by-puuid su alcune region.
    // Usiamo /lol/league/v4/entries/by-puuid/ che accetta direttamente il PUUID.
    let ranked_url = format!(
        "https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/{}",
        puuid
    );
    println!("ranked_url: {}", ranked_url);

    let ranked_res = client
        .get(&ranked_url)
        .header("X-Riot-Token", RIOT_API_KEY)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let ranked_text = ranked_res.text().await.unwrap_or_default();
    println!("ranked_entries raw: {}", ranked_text);

    let ranked_entries: Value = serde_json::from_str(&ranked_text).unwrap_or(json!([]));

    // summoner_level e profileIconId li prendiamo dalla risposta by-puuid che già abbiamo
    let summoner_url = format!(
        "https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{}",
        puuid
    );
    let summoner: Value = client
        .get(&summoner_url)
        .header("X-Riot-Token", RIOT_API_KEY)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .unwrap_or(json!({}));

    let match_ids = fetch_match_ids(&puuid, 0, 10, &client).await;
    let mut match_details: Vec<Value> = vec![];
    for id in match_ids.iter() {
        println!("Fetching search match: {}", id);
        let detail = fetch_match_detail(id, &client).await;
        match_details.push(detail);
    }

    // Normalizza ranked_entries: assicura che "rank" esista
    // (Riot API search restituisce "rank", ma verifichiamo anche "division" come fallback)
    let normalized_entries: Vec<Value> = ranked_entries
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|e| {
            let mut entry = e.clone();
            if entry["rank"].is_null() || entry["rank"].as_str().unwrap_or("") == "" {
                if let Some(div) = e["division"].as_str() {
                    entry["rank"] = json!(div);
                }
            }
            entry
        })
        .collect();

    println!("Ranked entries trovati per search: {}", normalized_entries.len());

    Ok(json!({
        "puuid": puuid,
        "profile": {
            "gameName": account["gameName"],
            "tagLine": account["tagLine"],
            "summonerLevel": summoner["summonerLevel"],
            "profileIconId": summoner["profileIconId"],
            "xpSinceLastLevel": 0,
            "xpUntilNextLevel": 1,
        },
        "ranked_entries": normalized_entries,
        "matches": match_details,
    }))
}

#[tauri::command]
async fn get_opgg_data(game_name: String, tag_line: String) -> Result<Value, String> {
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .unwrap();

    // 1. Profilo summoner con rank e champion pool
    let profile_result = call_opgg_tool(
        "lol_get_summoner_profile",
        json!({
            "summoner_id": format!("{}#{}", game_name, tag_line),
            "region": "euw",
            "desired_output_fields": [
                "data.summoner.{game_name,tagline,level}",
                "data.summoner.league_stats[].{game_type,win,lose,is_ranked}",
                "data.summoner.league_stats[].tier_info.{tier,division,lp}",
                "data.summoner.most_champion_stats[].{champion_id,play,win,lose,kill,death,assist,kda}"
            ]
        }),
        &client,
    ).await;

    // 2. Meta champion per lane (dati globali)
    let meta_result = call_opgg_tool(
        "lol_list_lane_meta_champions",
        json!({
            "region": "euw",
            "desired_output_fields": [
                "data[].{champion_id,position,tier,win_rate,pick_rate,ban_rate,kda}"
            ]
        }),
        &client,
    ).await;

    println!("OP.GG profile result: {:?}", profile_result.is_ok());
    println!("OP.GG meta result: {:?}", meta_result.is_ok());

    Ok(json!({
        "profile": profile_result.unwrap_or(json!(null)),
        "meta": meta_result.unwrap_or(json!(null)),
    }))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_profiles,
            get_more_matches,
            search_summoner,
            get_opgg_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}