; Script NSIS do instalador do Haxys Flow.
;
; ── O QUE ESTAVA ERRADO AQUI ATÉ A 1.1.16 ────────────────────────────────────
; Este arquivo nasceu quando o app se chamava "Haxys Core" e nunca foi renomeado. As três
; consequências eram silenciosas:
;
;   1. A pergunta de iniciar com o Windows gravava `"$INSTDIR\Haxys Core.exe" --hidden` —
;      um caminho que NÃO EXISTE. Quem respondesse "Sim" ganhava uma entrada morta no
;      registro: o app não subia no login e não havia erro nenhum para explicar.
;   2. O `taskkill` do desinstalador mirava "Haxys Core.exe". Como o processo é
;      "Haxys Flow.exe", ele não matava nada — e este macro também roda no modo SILENCIOSO,
;      que é o que precede toda ATUALIZAÇÃO. Ou seja: atualizar com o app aberto (e ele vive
;      na bandeja, então está sempre aberto) tentava substituir arquivos em uso.
;   3. "Apagar os dados do usuário" removia `$APPDATA\Haxys Core`. A pasta real é
;      `$APPDATA\Haxys Flow` — desinstalar com a caixa marcada não apagava nada.
;
; ── E POR QUE A PERGUNTA DE AUTO-START SAIU ──────────────────────────────────
; "Iniciar com o Windows" agora é ajuste do próprio app (Configurações › Este dispositivo,
; e o menu da bandeja), gravado via `setLoginItemSettings`. Perguntar no instalador criaria
; um SEGUNDO dono do mesmo interruptor, escrevendo em outro nome de valor — e as duas
; verdades discordariam na primeira vez que alguém mexesse na tela.

; ── Depois de instalar ───────────────────────────────────────────────────────

!macro customInstall
  ; Entrada legada das versões que perguntavam aqui. Apontava para um executável que não
  ; existe, então só atrasa o login de quem a tem.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HaxysCore"
!macroend

; ── Antes de desinstalar ─────────────────────────────────────────────────────
; Roda TAMBÉM no modo silencioso, que é o passo de desinstalação de toda atualização.
; O que vale para os dois casos fica acima do `IfSilent`; o que é só do desinstalador de
; verdade fica abaixo — senão cada atualização apagaria a preferência de auto-start.

!macro customUnInstall
  ExecWait 'taskkill /F /IM "Haxys Flow.exe" /T' $0
  Sleep 2000

  IfSilent skipDelete

  ; Auto-start: o nome do valor é o que o Electron usa em `setLoginItemSettings`.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Haxys Flow"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "HaxysCore"

  MessageBox MB_YESNO|MB_ICONQUESTION "Deseja apagar os dados do usuário (login, cookies, configurações)?" IDNO skipDelete

  SetShellVarContext current

  RMDir /r "$APPDATA\Haxys Flow"
  RMDir /r "$LOCALAPPDATA\Haxys Flow"
  RMDir /r "$LOCALAPPDATA\haxysflow-updater"

  SetShellVarContext all

  skipDelete:
!macroend
