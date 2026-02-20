mod champ_select;
use champ_select::{get_champ_select_session, auto_import_build,debug_champ_select_slot};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_champ_select_session,
            auto_import_build,
            debug_champ_select_slot,   // ← aggiungi questa

        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
