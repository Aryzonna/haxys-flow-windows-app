; Custom NSIS script for Haxys Core
; - Install: option to start with Windows
; - Uninstall: option to delete user data

; ── After Install ────────────────────────────────────────────────────

!macro customInstall
  IfSilent skipAutoStart
  MessageBox MB_YESNO|MB_ICONQUESTION "Deseja iniciar o Haxys Core automaticamente com o Windows?" IDNO skipAutoStart

  ; Write registry entry for auto-start (hidden in tray)
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HaxysCore" '"$INSTDIR\Haxys Core.exe" --hidden'

  skipAutoStart:
!macroend

; ── Before Uninstall ─────────────────────────────────────────────────

!macro customUnInstall
  ; Kill the app if still running
  ExecWait 'taskkill /F /IM "Haxys Core.exe" /T' $0
  Sleep 2000

  IfSilent skipDelete
  
  ; Remove auto-start registry entry
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HaxysCore"

  MessageBox MB_YESNO|MB_ICONQUESTION "Deseja apagar os dados do usuário (login, cookies, configurações)?" IDNO skipDelete

  ; User clicked YES — delete all user data
  SetShellVarContext current

  RMDir /r "$APPDATA\Haxys Core"
  RMDir /r "$LOCALAPPDATA\Haxys Core"
  RMDir /r "$LOCALAPPDATA\haxyscore-updater"

  SetShellVarContext all

  skipDelete:
!macroend
