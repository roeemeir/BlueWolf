param(
    [string]$VenvPath = ".bluewolf-runtime-venv",
    [string]$OperationalConfig = "",
    [int]$Port = 8080,
    [int]$StaleSeconds = 15,
    [int]$ExpireSeconds = 60
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$ResolvedVenv = Join-Path $RepoRoot $VenvPath
$RuntimeExe = Join-Path $ResolvedVenv "Scripts\bluewolf-runtime.exe"

if (-not (Test-Path $RuntimeExe)) {
    throw "Blue Wolf runtime is not installed. Run deploy\windows\install-runtime.ps1 first."
}
if ([string]::IsNullOrWhiteSpace($env:BLUEWOLF_CORE_API_TOKEN)) {
    throw "BLUEWOLF_CORE_API_TOKEN must be supplied through the Windows service/environment configuration."
}
if ($Port -lt 1 -or $Port -gt 65535) {
    throw "Port must be in the range 1..65535."
}
if ($StaleSeconds -le 0 -or $ExpireSeconds -le $StaleSeconds) {
    throw "ExpireSeconds must be greater than StaleSeconds and both must be positive."
}

$env:BLUEWOLF_RUNTIME_HOST = "0.0.0.0"
$env:BLUEWOLF_RUNTIME_PORT = [string]$Port
$env:BLUEWOLF_RUNTIME_STALE_SECONDS = [string]$StaleSeconds
$env:BLUEWOLF_RUNTIME_EXPIRE_SECONDS = [string]$ExpireSeconds

if (-not [string]::IsNullOrWhiteSpace($OperationalConfig)) {
    $ResolvedConfig = Resolve-Path $OperationalConfig -ErrorAction Stop
    $env:BLUEWOLF_OPERATIONAL_CONFIG = [string]$ResolvedConfig
    Write-Host "Operational polling enabled with config $ResolvedConfig"
}
else {
    Remove-Item Env:BLUEWOLF_OPERATIONAL_CONFIG -ErrorAction SilentlyContinue
    Write-Host "No operational config supplied; runtime will start in transport-only mode."
}

Write-Host "Starting Blue Wolf runtime on port $Port (single process)."
& $RuntimeExe
exit $LASTEXITCODE
