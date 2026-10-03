Set oShell  = CreateObject("WScript.Shell")
Set oHTTP   = CreateObject("MSXML2.XMLHTTP")

' Kill any existing node on port 3000
oShell.Run "cmd /c taskkill /IM node.exe /F >nul 2>&1", 0, True
WScript.Sleep 1000

' Start Node server in a visible window (stays open)
oShell.Run """C:\Program Files\nodejs\node.exe"" ""C:\GSTINValidator\server.js""", 1, False

' Wait until port 3000 actually responds (max 30 seconds)
Dim isReady, tries
isReady = False
tries   = 0

Do While (Not isReady) And (tries < 30)
    WScript.Sleep 1000
    tries = tries + 1
    On Error Resume Next
    oHTTP.Open "GET", "http://localhost:3000/health", False
    oHTTP.Send
    If oHTTP.Status = 200 Then
        isReady = True
    End If
    On Error GoTo 0
Loop

' Open browser only after server is confirmed ready
oShell.Run "http://localhost:3000"
