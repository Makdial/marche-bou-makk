#requires -Version 5.1
<#
  Installs the Marche Bou Makk watchdog so the API and Cloudflare Tunnel
  restart automatically.

  Run:
    powershell -ExecutionPolicy Bypass -File scripts\install-watchdog.ps1

  Preferred path (needs Task Scheduler access):
    MarcheBouMakk-Watchdog           - starts at logon, loops forever
    MarcheBouMakk-Watchdog-Keepalive - runs every 5 minutes and relaunches the
                                       watchdog if it stopped

  Fallback (when Task Scheduler is blocked, e.g. no admin rights):
    - copies scripts\start-watchdog.vbs into the user's Startup folder
    - launches the watchdog through WMI, which detaches it from the current
      terminal session so it keeps running after the shell exits
#>

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$watchdog = Join-Path $root 'scripts\watchdog.ps1'
$launcher = Join-Path $root 'scripts\start-watchdog.vbs'

if (-not (Test-Path $watchdog)) { throw "Watchdog script not found: $watchdog" }
if (-not (Test-Path $launcher)) { throw "Launcher not found: $launcher" }

function Start-WatchdogNow {
  $command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $watchdog + '"'
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command }
  if ($result.ReturnValue -ne 0) {
    throw "Could not start the watchdog (Win32_Process.Create returned $($result.ReturnValue))."
  }
}

$taskSchedulerWorked = $false

try {
  $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $watchdog + '"'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

  Register-ScheduledTask `
    -TaskName 'MarcheBouMakk-Watchdog' `
    -Action $action `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn) `
    -Settings $settings `
    -Description 'Keeps the Marche Bou Makk API and Cloudflare Tunnel running.' `
    -Force | Out-Null

  Register-ScheduledTask `
    -TaskName 'MarcheBouMakk-Watchdog-Keepalive' `
    -Action $action `
    -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)) `
    -Settings $settings `
    -Description 'Relaunches the Marche Bou Makk watchdog if it stopped.' `
    -Force | Out-Null

  Start-ScheduledTask -TaskName 'MarcheBouMakk-Watchdog'
  Start-ScheduledTask -TaskName 'MarcheBouMakk-Watchdog-Keepalive'
  $taskSchedulerWorked = $true
  Write-Host 'Registered scheduled tasks (at logon + every 5 minutes).'
} catch {
  Write-Warning ('Task Scheduler is not available: ' + $_.Exception.Message)
}

if (-not $taskSchedulerWorked) {
  $startup = [Environment]::GetFolderPath('Startup')
  $target = Join-Path $startup 'MarcheBouMakk-Watchdog.vbs'
  Copy-Item -Path $launcher -Destination $target -Force
  Write-Host "Installed Startup shortcut: $target"

  Start-WatchdogNow
  Write-Host 'Watchdog started through WMI (survives this terminal closing).'
}

Start-Sleep -Seconds 5
Write-Host 'Logs: logs\watchdog.log'
