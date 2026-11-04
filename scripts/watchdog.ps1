#requires -Version 5.1
<#
  Marche Bou Makk watchdog.

  Keeps the production API (Node) and the Cloudflare Tunnel alive.
  Started by Windows Task Scheduler ("MarcheBouMakk-Watchdog") at logon,
  and re-launched every few minutes by "MarcheBouMakk-Watchdog-Keepalive"
  if it is not running.

  It survives the terminal/agent session that started it, because Task
  Scheduler owns the process instead of a shell.
#>

$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$logFile = Join-Path $logDir 'watchdog.log'
$apiOut = Join-Path $logDir 'api.out.log'
$apiErr = Join-Path $logDir 'api.err.log'
$tunOut = Join-Path $logDir 'tunnel.out.log'
$tunErr = Join-Path $logDir 'tunnel.err.log'

$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }

$cloudflared = 'C:\Users\makhf\tools\cloudflared.exe'
if (-not (Test-Path $cloudflared)) {
  $found = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($found) { $cloudflared = $found.Source }
}

$apiUrl = 'http://localhost:4000/api/settings'
$publicUrl = 'https://marcheboumakk.com'

# JWT secret lives in data/ (gitignored) and stays stable across restarts.
# Generated once on first run so it is never committed to the repository.
$secretFile = Join-Path $root 'data\jwt-secret.txt'
$jwtSecret = $null
if (Test-Path $secretFile) {
  $jwtSecret = (Get-Content -Path $secretFile -Raw).Trim()
}
if (-not $jwtSecret) {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $jwtSecret = [Convert]::ToBase64String($bytes)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $secretFile) | Out-Null
  Set-Content -Path $secretFile -Value $jwtSecret -NoNewline
}

function Write-Log([string]$message) {
  try {
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 2MB)) {
      Move-Item -Path $logFile -Destination "$logFile.old" -Force
    }
    Add-Content -Path $logFile -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message)
  } catch { }
}

function Test-Api {
  try {
    $r = Invoke-WebRequest -Uri $apiUrl -UseBasicParsing -TimeoutSec 10
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Test-Public {
  try {
    $r = Invoke-WebRequest -Uri $publicUrl -UseBasicParsing -TimeoutSec 20
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Get-ApiProcesses {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*src/server/index.ts*' }
}

function Get-TunnelProcesses {
  Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
    Where-Object { $_.CommandLine -like '*marche-bou-makk*' }
}

function Start-Api {
  Get-ApiProcesses | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
  }
  Start-Sleep -Seconds 2

  $env:NODE_ENV = 'production'
  $env:SEED_DEMO = 'true'
  $env:PORT = '4000'
  $env:JWT_SECRET = $jwtSecret

  try {
    Start-Process -FilePath $node `
      -ArgumentList '--import', 'tsx', 'src/server/index.ts' `
      -WorkingDirectory $root `
      -RedirectStandardOutput $apiOut `
      -RedirectStandardError $apiErr `
      -WindowStyle Hidden
    Write-Log 'API start requested'
  } catch {
    Write-Log ('API start failed: ' + $_.Exception.Message)
  }
}

function Start-Tunnel {
  Get-TunnelProcesses | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
  }
  Start-Sleep -Seconds 2

  try {
    Start-Process -FilePath $cloudflared `
      -ArgumentList 'tunnel', 'run', 'marche-bou-makk' `
      -WorkingDirectory $root `
      -RedirectStandardOutput $tunOut `
      -RedirectStandardError $tunErr `
      -WindowStyle Hidden
    Write-Log 'Tunnel start requested'
  } catch {
    Write-Log ('Tunnel start failed: ' + $_.Exception.Message)
  }
}

# Only one watchdog instance at a time.
$mutex = New-Object System.Threading.Mutex($false, 'Local\MarcheBouMakkWatchdog')
if (-not $mutex.WaitOne(0)) { exit 0 }

Write-Log 'Watchdog started'

$apiFailures = 0
$publicFailures = 0
$loop = 0

while ($true) {
  $loop++

  try {
    if (Test-Api) {
      if ($apiFailures -gt 0) { Write-Log 'API is healthy again' }
      $apiFailures = 0
    } else {
      $apiFailures++
      Write-Log ('API not responding (attempt ' + $apiFailures + ')')
      Start-Api
      Start-Sleep -Seconds 12
      if (Test-Api) {
        Write-Log 'API recovered'
        $apiFailures = 0
      } elseif ($apiFailures -ge 5) {
        Write-Log 'API repeatedly failing, backing off 60s'
        Start-Sleep -Seconds 60
      }
    }

    if (-not (Get-TunnelProcesses)) {
      Write-Log 'Tunnel process not running'
      Start-Tunnel
      Start-Sleep -Seconds 10
    }

    # Every ~2 minutes verify the public site end-to-end. A 530/1033 means the
    # tunnel is connected to Cloudflare but cannot reach the origin.
    if (($loop % 6) -eq 0) {
      if (Test-Public) {
        $publicFailures = 0
      } else {
        $publicFailures++
        Write-Log ('Public site check failed (attempt ' + $publicFailures + ')')
        if ($publicFailures -ge 2) {
          Write-Log 'Restarting tunnel after repeated public failures'
          Start-Tunnel
          $publicFailures = 0
          Start-Sleep -Seconds 15
        }
      }
    }
  } catch {
    Write-Log ('Watchdog error: ' + $_.Exception.Message)
  }

  Start-Sleep -Seconds 20
}
