# ============================================================
#  SETUP TAURI UPDATER — Repo privata GitHub
#  Segui questi passi UNA VOLTA SOLA
# ============================================================


# ── PASSO 1: Installa il plugin updater ───────────────────────
#
# Nel terminale, nella root del progetto:

cargo add tauri-plugin-updater --manifest-path src-tauri/Cargo.toml

# In src-tauri/src/main.rs, aggiungi il plugin:
#
#   tauri::Builder::default()
#       .plugin(tauri_plugin_updater::Builder::new().build())
#       ...


# ── PASSO 2: Genera le chiavi di firma ────────────────────────
#
# Esegui UNA VOLTA e conserva le chiavi in modo sicuro:



# Output esempio:
#   Public key:  dW50cnVzdGVkIGNvbW1lbnQ6...
#   Private key: salvata in ~/.tauri/rlp.key

# Imposta le variabili d'ambiente (aggiungile al tuo profilo PowerShell):
$env:TAURI_PRIVATE_KEY = (Get-Content ~/.tauri/rlp.key -Raw)
$env:TAURI_KEY_PASSWORD = ""   # oppure la password che hai scelto


# ── PASSO 3: tauri.conf.json ──────────────────────────────────
#
# Aggiungi/modifica la sezione "bundle" → "createUpdaterArtifacts"
# e aggiungi il plugin "updater":
#
# {
#   "productName": "RLP Analytics",
#   "version": "1.0.0",
#   "bundle": {
#     "createUpdaterArtifacts": true,        ← AGGIUNTO
#     ...
#   },
#   "plugins": {
#     "updater": {
#       "pubkey": "LA_TUA_CHIAVE_PUBBLICA",  ← dalla PASSO 2
#       "endpoints": [
#         "https://github.com/TUO_USERNAME/rlp-analytics/releases/latest/download/latest.json"
#       ]
#     }
#   }
# }
#
# NOTA: Per repo privata GitHub, il latest.json è pubblicamente
# accessibile anche se la repo è privata, perché le Release
# possono essere pubbliche anche con repo privata.
# Se vuoi tenere anche le Release private, usa invece un tuo
# server con autenticazione (più complesso).


# ── PASSO 4: Mostra dialog di update nell'app ─────────────────
#
# In App.jsx (o main.jsx), aggiungi all'avvio:

# import { check } from "@tauri-apps/plugin-updater";
# import { relaunch } from "@tauri-apps/plugin-process";
#
# // Nel useEffect iniziale:
# async function checkForUpdates() {
#     try {
#         const update = await check();
#         if (update?.available) {
#             const yes = await confirm(
#                 `Disponibile RLP v${update.version}!\n\n${update.body}\n\nVuoi aggiornare ora?`,
#                 { title: "Aggiornamento disponibile", kind: "info" }
#             );
#             if (yes) {
#                 await update.downloadAndInstall();
#                 await relaunch();
#             }
#         }
#     } catch (e) {
#         console.warn("[Updater]", e);
#     }
# }
# checkForUpdates();


# ── PASSO 5: Variabili d'ambiente per lo script release ───────
#
# Aggiungi al tuo profilo PowerShell ($PROFILE):

$env:GITHUB_TOKEN  = "ghp_IL_TUO_PERSONAL_ACCESS_TOKEN"
$env:TAURI_PRIVATE_KEY = (Get-Content ~/.tauri/rlp.key -Raw)
$env:TAURI_KEY_PASSWORD = ""

# Il token GitHub deve avere i permessi:
#   ✓ repo (accesso completo alla repo privata)
#   ✓ write:packages (per le release)


# ── USO DELLO SCRIPT RELEASE ──────────────────────────────────
#
# Quando vuoi rilasciare una nuova versione:

.\release.ps1 -Version "1.1.0" -Notes "Fix live game + maestrie"

# Lo script:
#   1. Verifica che dev sia pulito
#   2. Aggiorna la versione in tauri.conf.json e Cargo.toml
#   3. Committa + pusha dev
#   4. Merge dev → main con tag
#   5. Fa la build Tauri (firmata)
#   6. Crea latest.json
#   7. Pubblica la GitHub Release con .msi + .msi.zip + latest.json
