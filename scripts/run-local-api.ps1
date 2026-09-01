# Local launcher for the Food Assistant API (api/*.js) with real env vars.
#
# vercel.json uses legacy `builds`+`routes`, under which `vercel dev` does not inject dashboard
# or .env-file variables into function process.env. This script loads .env.local into the shell
# session first, so the launched `vercel dev` (and its function runtime) inherits everything.
#
# Usage:  powershell -File scripts\run-local-api.ps1     (Ctrl+C to stop)

$root = Split-Path -Parent $PSScriptRoot
Get-Content (Join-Path $root ".env.local") | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?(.*?)"?\s*$' -and $_ -notmatch '^\s*#') {
    Set-Item -Path ("Env:" + $Matches[1]) -Value $Matches[2]
  }
}

Set-Location $root
vercel dev --listen 127.0.0.1:3000
