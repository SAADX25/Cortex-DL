!macro customUnInstall
  ; Remove the updater cache (The huge folder)
  RMDir /r "$LOCALAPPDATA\cortex-dl-updater"

  ; Remove the App Data (Settings, etc)
  RMDir /r "$APPDATA\Cortex DL"
  
  ; Remove the installation folder itself (just in case)
  RMDir /r "$INSTDIR"
!macroend