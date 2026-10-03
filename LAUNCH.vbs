Set oShell = CreateObject("WScript.Shell")

' Kill any old node on port 3000
oShell.Run "cmd /c taskkill /IM node.exe /F >nul 2>&1", 0, True
WScript.Sleep 500

' Start node server in a visible window that stays open
oShell.Run """C:\Program Files\nodejs\node.exe"" ""C:\GSTINValidator\server.js""", 1, False

' Wait for server to start
WScript.Sleep 5000

' Open browser
oShell.Run "http://localhost:3000"

' Done - user sees the node window and can close it when finished
