param([switch]$Preview)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if ([IO.Path]::GetPathRoot($projectRoot) -eq 'C:\') {
    throw 'Keep this project on a non-C drive. No files have been downloaded.'
}
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw 'Node.js was not found. Install Node.js 22.12+ on D: or E: before continuing.'
}
$nodeParts = ((& node --version).TrimStart('v').Split('.'))
if ([int]$nodeParts[0] -lt 22 -or ([int]$nodeParts[0] -eq 22 -and [int]$nodeParts[1] -lt 12)) { throw 'Please use the existing Node.js 22.12+ or 24+ installation.' }
$taskTemp = Join-Path $projectRoot '.cache\tmp'
New-Item -ItemType Directory -Force -Path $taskTemp | Out-Null
$env:TEMP = $taskTemp
$env:TMP = $taskTemp
$env:npm_config_cache = Join-Path $projectRoot '.cache\npm'
$env:npm_config_prefix = Join-Path $projectRoot '.tools\npm'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.cache\browsers'
$env:npm_config_update_notifier = 'false'
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) { throw 'npm.cmd was not found alongside Node.js.' }
# Check local project dependencies before installing anything. No global packages.
& node scripts/check-dependencies.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Missing project dependencies. Installing into this project on E:/D:...'
    & $npmCommand.Source ci --prefer-offline --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check .cache/npm/_logs on this drive.' }
} else { Write-Host 'Existing project dependencies found. No installation needed.' }
if ($Preview) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) {
        & $npmCommand.Source run build
        if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    }
    Write-Host 'Static preview: http://127.0.0.1:4173/ (Ctrl+C to stop)'
    & $npmCommand.Source run preview -- --port 4173 --strictPort
} else {
    Write-Host 'Local workbench: http://127.0.0.1:5173/ (Ctrl+C to stop)'
    & $npmCommand.Source run dev
}
