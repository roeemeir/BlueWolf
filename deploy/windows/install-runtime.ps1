param(
    [string]$PythonCommand = "py",
    [string]$VenvPath = ".bluewolf-runtime-venv",
    [string]$Wheelhouse = "",
    [string]$CodeSha = "",
    [switch]$Online
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$CorePath = Join-Path $RepoRoot "core"
$ResolvedVenv = Join-Path $RepoRoot $VenvPath
$BuildProvenancePath = Join-Path $ResolvedVenv "bluewolf-build-provenance.json"

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

$ResolvedCodeSha = $CodeSha.Trim()
if ([string]::IsNullOrWhiteSpace($ResolvedCodeSha)) {
    try {
        $GitSha = (& git -C $RepoRoot rev-parse HEAD 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($GitSha)) {
            $ResolvedCodeSha = ([string]$GitSha).Trim()
        }
    }
    catch {
        $ResolvedCodeSha = ""
    }
}
if ([string]::IsNullOrWhiteSpace($ResolvedCodeSha) -or $ResolvedCodeSha -eq "unknown" -or $ResolvedCodeSha -notmatch '^[0-9a-fA-F]{7,64}$') {
    throw "A real code SHA is required. Run from the Git checkout or pass -CodeSha explicitly."
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

$BuildProvenance = [ordered]@{
    schemaVersion = "bluewolf.runtime-build-provenance.v1"
    codeSha = $ResolvedCodeSha.ToLowerInvariant()
    installedAtUtc = [DateTime]::UtcNow.ToString("o")
}
$BuildProvenance | ConvertTo-Json -Compress | Set-Content -Path $BuildProvenancePath -Encoding UTF8

Write-Host "Blue Wolf runtime installed successfully."
Write-Host "Build provenance saved to $BuildProvenancePath (code $($ResolvedCodeSha.Substring(0, [Math]::Min(12, $ResolvedCodeSha.Length))))."
Write-Host "This installs the Python runtime only, not the full offline UI, maps or PDF package."
Write-Host "Set BLUEWOLF_CORE_API_TOKEN and run deploy\windows\run-runtime.ps1"
