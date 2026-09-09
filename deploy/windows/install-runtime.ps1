param(
    [string]$PythonCommand = "py",
    [string]$VenvPath = ".bluewolf-runtime-venv"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$CorePath = Join-Path $RepoRoot "core"
$ResolvedVenv = Join-Path $RepoRoot $VenvPath

Write-Host "Creating Blue Wolf runtime environment at $ResolvedVenv"
& $PythonCommand -3.12 -m venv $ResolvedVenv

$PythonExe = Join-Path $ResolvedVenv "Scripts\python.exe"
& $PythonExe -m pip install --upgrade pip

Push-Location $CorePath
try {
    & $PythonExe -m pip install ".[service,influx]"
}
finally {
    Pop-Location
}

Write-Host "Blue Wolf runtime installed successfully."
Write-Host "Set BLUEWOLF_CORE_API_TOKEN and run deploy\windows\run-runtime.ps1"
