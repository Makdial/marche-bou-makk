' Marche Bou Makk - launches the watchdog hidden (no console window).
' Used at logon (Startup folder) and for manual starts.
Set shell = CreateObject("WScript.Shell")
script = "C:\Users\makhf\OneDrive\Desktop\marche_bou_makk\scripts\watchdog.ps1"
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """", 0, False
