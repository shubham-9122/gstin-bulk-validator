Set oShell = CreateObject("WScript.Shell")
Set oHTTP  = CreateObject("MSXML2.XMLHTTP")
Set oFSO   = CreateObject("Scripting.FileSystemObject")

' ── Check if server is already running ────────────────────────────────────
Dim alreadyRunning
alreadyRunning = False
On Error Resume Next
oHTTP.Open "GET", "http://localhost:3000/health", False
oHTTP.setRequestHeader "Connection", "close"
oHTTP.Send
If oHTTP.Status = 200 Then alreadyRunning = True
On Error GoTo 0

If alreadyRunning Then
    ' Already running — just open the browser
    oShell.Run "http://localhost:3000"
    WScript.Quit
End If

' ── Kill any stuck node processes ─────────────────────────────────────────
oShell.Run "cmd /c taskkill /IM node.exe /F >nul 2>&1", 0, True
WScript.Sleep 1000

' ── Verify node.exe exists ────────────────────────────────────────────────
Dim nodePath
nodePath = "C:\Program Files\nodejs\node.exe"
If Not oFSO.FileExists(nodePath) Then
    MsgBox "Node.js not found at:" & Chr(13) & nodePath & Chr(13) & Chr(13) & _
           "Please install Node.js from https://nodejs.org", 16, "GSTIN Validator - Error"
    WScript.Quit
End If

' ── Verify server.js exists ───────────────────────────────────────────────
Dim serverPath
serverPath = "C:\GSTINValidator\server.js"
If Not oFSO.FileExists(serverPath) Then
    MsgBox "server.js not found at C:\GSTINValidator\" & Chr(13) & Chr(13) & _
           "Please reinstall the tool.", 16, "GSTIN Validator - Error"
    WScript.Quit
End If

' ── Start Node server in visible window ───────────────────────────────────
oShell.Run """" & nodePath & """ """ & serverPath & """", 1, False

' ── Wait until port 3000 responds (max 30 seconds) ────────────────────────
Dim ready, tries
ready = False
tries = 0

Do While (Not ready) And (tries < 30)
    WScript.Sleep 1000
    tries = tries + 1
    On Error Resume Next
    oHTTP.Open "GET", "http://localhost:3000/health", False
    oHTTP.setRequestHeader "Connection", "close"
    oHTTP.Send
    If oHTTP.Status = 200 Then ready = True
    On Error GoTo 0
Loop

' ── Open browser ──────────────────────────────────────────────────────────
If ready Then
    oShell.Run "http://localhost:3000"
Else
    MsgBox "Server did not start in 30 seconds." & Chr(13) & Chr(13) & _
           "Try opening http://localhost:3000 manually in your browser." & Chr(13) & _
           "If it still fails, restart your PC and try again.", 48, "GSTIN Validator"
    oShell.Run "http://localhost:3000"
End If
