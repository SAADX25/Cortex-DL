!macro customHeader
  !ifndef BUILD_UNINSTALLER
    Var cortexLegacyBackup
  !endif
!macroend

!macro customInit
  StrCpy $cortexLegacyBackup ""
  ReadRegStr $R2 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${if} $R2 == "2.1.0"
  ${orIf} $R2 == "2.0.0"
    ; Legacy customUnInstall ignores /KEEP_APP_DATA. Protect its data first.
    nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    ${if} $R0 == 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Close Cortex DL before upgrading so history can be protected." /SD IDOK
      Abort
    ${endIf}
    ${if} ${FileExists} "$APPDATA\Cortex DL\*.*"
      StrCpy $cortexLegacyBackup "$APPDATA\Cortex DL.upgrade-2.1.5-backup"
      ${if} ${FileExists} "$cortexLegacyBackup\*.*"
        MessageBox MB_OK|MB_ICONEXCLAMATION "An earlier upgrade backup exists. Preserve it and restore it before retrying this upgrade." /SD IDOK
        Abort
      ${endIf}
      ClearErrors
      Rename "$APPDATA\Cortex DL" "$cortexLegacyBackup"
      ${if} ${Errors}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Cannot protect application history. Upgrade stopped without removing data." /SD IDOK
        Abort
      ${endIf}
    ${endIf}
  ${endIf}
!macroend

!macro customInstall
  ${if} $cortexLegacyBackup != ""
    ; Legacy uninstall has removed the old, now-empty app data path.
    ClearErrors
    Rename "$cortexLegacyBackup" "$APPDATA\Cortex DL"
    ${if} ${Errors}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Application data is preserved in $cortexLegacyBackup. Restore that folder before opening Cortex DL." /SD IDOK
      SetErrorLevel 2
      Quit
    ${endIf}
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove Cortex DL history, settings and engines? Downloaded media will be preserved." IDNO preserveData
    RMDir /r "$APPDATA\Cortex DL"
    preserveData:
  ${endIf}
!macroend
