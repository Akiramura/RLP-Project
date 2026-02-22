# ============================================================
#  RLP — Release Script
#  Uso: .\release.ps1 -Version "1.2.0" [-Notes "Descrizione"]
#
#  Cosa fa:
#   1. Sincronizza dev → main (merge + push)
#   2. Aggiorna la versione in tauri.conf.json e Cargo.toml
#   3. Fa la build Tauri (genera .msi + .msi.zip + .sig)
#   4. Crea il file latest.json per l'auto-updater
#   5. Pubblica la GitHub Release con tutti i file
# ============================================================

param(
    [Parameter(Mandatory)]
    [string]$Version,

    [string]$Notes = "Nuova versione $Version"
)

# ── Configurazione ────────────────────────────────────────────
$GITHUB_OWNER  = "Akiramura"          # ← cambia
$GITHUB_REPO   = "RLP-Project"         # ← cambia
$GITHUB_TOKEN  = "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"       # imposta la variabile d'ambiente oppure metti qui il token
$DEV_BRANCH    = "dev"
$MAIN_BRANCH   = "master"
$TAURI_CONF    = "src-tauri\tauri.conf.json"
$CARGO_TOML    = "src-tauri\Cargo.toml"
# ─────────────────────────────────────────────────────────────

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Log($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Ok($msg)  { Write-Host "OK $msg" -ForegroundColor Green }
function Err($msg) { Write-Host "!! $msg" -ForegroundColor Red; exit 1 }

# ── Controlli preliminari ─────────────────────────────────────
if (-not $GITHUB_TOKEN) { Err "GITHUB_TOKEN non impostato. Esegui: `$env:GITHUB_TOKEN = 'ghp_...'" }
if (-not (Get-Command "gh" -ErrorAction SilentlyContinue)) { Err "GitHub CLI (gh) non installato. https://cli.github.com" }
if (-not (Get-Command "cargo" -ErrorAction SilentlyContinue)) { Err "Rust/Cargo non trovato nel PATH." }

# Verifica che il version sia nel formato corretto (semver)
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Err "Versione non valida: '$Version'. Usa formato X.Y.Z (es. 1.2.0)" }

Log "Inizio release v$Version"

# ── 1. Git: sincronizza dev → main ───────────────────────────
Log "Sincronizzazione branch..."

$currentBranch = git rev-parse --abbrev-ref HEAD
if ($LASTEXITCODE -ne 0) { Err "Non sei in una repo git." }

# Assicurati di essere su dev e che sia pulito
git checkout $DEV_BRANCH | Out-Null

$status = git status --porcelain
if ($status) {
    Err "Hai modifiche non committate su '$DEV_BRANCH'. Fai commit prima di fare release."
}

# Pull dev per essere aggiornato
Log "Pull $DEV_BRANCH..."
git pull origin $DEV_BRANCH
if ($LASTEXITCODE -ne 0) { Err "Errore durante il pull di $DEV_BRANCH." }

# Aggiorna versione in tauri.conf.json
Log "Aggiorno versione in $TAURI_CONF..."
$tauriConf = Get-Content $TAURI_CONF -Raw | ConvertFrom-Json
$tauriConf.version = $Version
$tauriConf | ConvertTo-Json -Depth 20 | Set-Content $TAURI_CONF -Encoding UTF8
Ok "tauri.conf.json → $Version"

# Aggiorna versione in Cargo.toml
Log "Aggiorno versione in $CARGO_TOML..."
$cargoContent = Get-Content $CARGO_TOML -Raw
$cargoContent = $cargoContent -replace '(?m)^version = "\d+\.\d+\.\d+"', "version = `"$Version`""
Set-Content $CARGO_TOML $cargoContent -Encoding UTF8
Ok "Cargo.toml → $Version"

# Commit versione su dev
git add $TAURI_CONF $CARGO_TOML
git commit -m "chore: bump version to $Version"
if ($LASTEXITCODE -ne 0) { Err "Errore durante il commit della versione." }

# Push dev
Log "Push $DEV_BRANCH..."
git push origin $DEV_BRANCH
if ($LASTEXITCODE -ne 0) { Err "Errore durante il push di $DEV_BRANCH." }
Ok "Push $DEV_BRANCH completato"

# Merge dev → main
Log "Merge $DEV_BRANCH → $MAIN_BRANCH..."
git checkout $MAIN_BRANCH
if ($LASTEXITCODE -ne 0) { Err "Impossibile fare checkout di '$MAIN_BRANCH'." }

git pull origin $MAIN_BRANCH
git merge $DEV_BRANCH --no-ff -m "release: v$Version"
if ($LASTEXITCODE -ne 0) { Err "Conflitti durante il merge. Risolvili manualmente." }

# Tag
git tag -a "v$Version" -m "Release v$Version"

# Push main + tag
Log "Push $MAIN_BRANCH + tag..."
git push origin $MAIN_BRANCH
git push origin "v$Version"
if ($LASTEXITCODE -ne 0) { Err "Errore durante il push di $MAIN_BRANCH o del tag." }
Ok "Branch $MAIN_BRANCH aggiornato e tag v$Version creato"

# Torna su dev
git checkout $DEV_BRANCH

# ── 2. Build Tauri ────────────────────────────────────────────
Log "Avvio build Tauri (potrebbe richiedere qualche minuto)..."
npm run tauri build
if ($LASTEXITCODE -ne 0) { Err "Build Tauri fallita. Controlla l'output sopra." }
Ok "Build completata"

# ── 3. Trova i file generati ──────────────────────────────────
$bundleDir = "src-tauri\target\release\bundle"

# .msi
$msiFile = Get-ChildItem "$bundleDir\msi\*.msi" | Select-Object -First 1
if (-not $msiFile) { Err "File .msi non trovato in $bundleDir\msi\" }

# .msi.zip (per l'updater)
$msiZip = Get-ChildItem "$bundleDir\msi\*.msi.zip" | Select-Object -First 1
if (-not $msiZip) { Err "File .msi.zip non trovato. Assicurati che 'createUpdaterArtifacts' sia true in tauri.conf.json" }

# .msi.zip.sig (firma per l'updater)
$msiSig = Get-ChildItem "$bundleDir\msi\*.msi.zip.sig" | Select-Object -First 1
if (-not $msiSig) { Err "File .sig non trovato. Assicurati che TAURI_PRIVATE_KEY sia impostato." }

$signature = Get-Content $msiSig.FullName -Raw

Ok "File trovati:"
Write-Host "   MSI:     $($msiFile.Name)"
Write-Host "   ZIP:     $($msiZip.Name)"
Write-Host "   SIG:     $($msiSig.Name)"

# ── 4. Crea latest.json per l'auto-updater ────────────────────
Log "Generazione latest.json..."

$downloadBase = "https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/download/v$Version"

$latestJson = @{
    version  = $Version
    notes    = $Notes
    pub_date = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    platforms = @{
        "windows-x86_64" = @{
            url       = "$downloadBase/$($msiZip.Name)"
            signature = $signature.Trim()
        }
    }
} | ConvertTo-Json -Depth 5

$latestJsonPath = "latest.json"
$latestJson | Set-Content $latestJsonPath -Encoding UTF8
Ok "latest.json creato"

# ── 5. Pubblica GitHub Release ────────────────────────────────
Log "Creazione GitHub Release v$Version..."

# Crea la release e carica i file con GitHub CLI
gh release create "v$Version" `
    $msiFile.FullName `
    $msiZip.FullName `
    $msiSig.FullName `
    $latestJsonPath `
    --repo "$GITHUB_OWNER/$GITHUB_REPO" `
    --title "RLP v$Version" `
    --notes $Notes `
    --latest

if ($LASTEXITCODE -ne 0) { Err "Errore durante la creazione della GitHub Release." }

Ok "Release v$Version pubblicata su GitHub!"
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host " Release completata: https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/tag/v$Version" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
