param(
    [string]$PythonCommand = "py",
    [string]$VenvPath = ".bluewolf-runtime-venv",
    [string]$Wheelhouse = "",
    [switch]$Online
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$CorePath = Join-Path $RepoRoot "core"
$ResolvedVenv = Join-Path $RepoRoot $VenvPath

if ($Online -and -not [string]::IsNullOrWhiteSpace($Wheelhouse)) {
    throw "Choose either -Online or -Wheelhouse, not both."
}
if (-not $Online) {
    if ([string]::IsNullOrWhiteSpace($Wheelhouse)) {
        throw "Offline installation requires -Wheelhouse with locally prepared wheels. Use -Online only on a connected preparation machine."
    }
    $ResolvedWheelhouse = (Resolve-Path $Wheelhouse -ErrorAction Stop).Path
    if (-not (Test-Path $ResolvedWheelhouse -PathType Container)) {
        throw "Wheelhouse must be a local directory."
    }
    if (@(Get-ChildItem $ResolvedWheelhouse -Filter '*.whl' -File).Count -eq 0) {
        throw "Wheelhouse contains no wheels. Prepare Python 3.12 wheels for the target Windows architecture."
    }
}

Write-Host "Creating Blue Wolf runtime environment at $ResolvedVenv"
& $PythonCommand -3.12 -m venv $ResolvedVenv
if ($LASTEXITCODE -ne 0) { throw "Python 3.12 environment creation failed." }

$PythonExe = Join-Path $ResolvedVenv "Scripts\python.exe"

Push-Location $CorePath
try {
    if ($Online) {
        & $PythonExe -m pip --isolated --disable-pip-version-check install ".[service,influx]"
    }
    else {
        # --no-index applies to build isolation as well; missing build/runtime
        # wheels are an error, never a reason to silently contact PyPI.
        & $PythonExe -m pip --isolated --disable-pip-version-check install --no-index --find-links $ResolvedWheelhouse ".[service,influx]"
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Runtime dependency installation failed. No successful installation has been recorded."
    }
    & $PythonExe -m pip --isolated --disable-pip-version-check check
    if ($LASTEXITCODE -ne 0) { throw "Installed runtime dependencies are inconsistent." }
}
finally {
    Pop-Location
}

Write-Host "Blue Wolf runtime installed successfully."
Write-Host "This installs the Python runtime only, not the full offline UI, maps or PDF package."
Write-Host "Set BLUEWOLF_CORE_API_TOKEN and run deploy\windows\run-runtime.ps1"
