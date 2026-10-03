Set oShell = CreateObject("WScript.Shell")

' Kill any old node process
oShell.Run "cmd /c taskkill /IM node.exe /F >nul 2>&1", 0, True
WScript.Sleep 800

' Start the Node server (window stays visible so you can see errors)
oShell.Run """C:\Program Files\nodejs\node.exe"" ""C:\GSTINValidator\server.js""", 1, False

' Wait for server to start
WScript.Sleep 5000

' Open browser
oShell.Run "http://localhost:3000"
