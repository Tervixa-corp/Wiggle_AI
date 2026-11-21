; Tervixa Wiggle - self-contained Windows installer.
;
; Bundles the Node runtime, the full gateway, the built workbench UI, the
; provider/plugin/connector catalogs and a native WebView2 desktop window.
; Installs per-user under %LOCALAPPDATA%\Programs so no administrator rights
; are required and the install never touches a machine-wide location.

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "TextFunc.nsh"

!define APP_NAME        "Tervixa Wiggle"
!ifndef APP_VERSION
  !define APP_VERSION   "1.0.0"
!endif
!define APP_PUBLISHER   "Tervixa Corporation"
!define APP_EXE         "Tervixa Wiggle.exe"
!define UNINST_KEY      "Software\Microsoft\Windows\CurrentVersion\Uninstall\TervixaWiggle"
!define UNINST_DATA     "Software\Tervixa\Wiggle"

Name "${APP_NAME}"
OutFile "..\releases\Tervixa-Wiggle-${APP_VERSION}-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Tervixa Wiggle"
InstallDirRegKey HKCU "${UNINST_DATA}" "InstallDir"
RequestExecutionLevel user
BrandingText "${APP_NAME} - developed by ${APP_PUBLISHER}"

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName"     "${APP_NAME}"
VIAddVersionKey "CompanyName"     "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_NAME} installer"
VIAddVersionKey "FileVersion"     "${APP_VERSION}"
VIAddVersionKey "ProductVersion"  "${APP_VERSION}"
VIAddVersionKey "LegalCopyright"  "MIT License. Developed by Tervixa Corporation."

!define MUI_ICON   "stage\icon.ico"
!define MUI_UNICON "stage\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APP_NAME}"
!define MUI_FINISHPAGE_LINK "Developed by Tervixa Corporation"
!define MUI_FINISHPAGE_LINK_LOCATION "https://tervixa.in"
!define MUI_WELCOMEPAGE_TITLE "${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "This installs ${APP_NAME} ${APP_VERSION}, a local-first AI software engineering workbench by ${APP_PUBLISHER}.$\r$\n$\r$\nIt includes its own Node runtime, the full agent gateway, the workbench interface and the provider, plugin and connector catalogs. Nothing is installed machine-wide and no administrator rights are needed.$\r$\n$\r$\nYour API keys, plugins and memory stay on this machine."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "stage\app\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; Stop the launcher and its bundled gateway so files can be replaced.
!macro KILL_RUNNING
  nsExec::Exec '"$SYSDIR\taskkill.exe" /IM "${APP_EXE}" /F'
  Pop $0
  ClearErrors
  FileOpen $9 "$LOCALAPPDATA\Tervixa Wiggle\server.pid" r
  ${IfNot} ${Errors}
    FileRead $9 $8
    FileClose $9
    ${TrimNewLines} "$8" $8
    ${If} $8 != ""
      nsExec::Exec '"$SYSDIR\taskkill.exe" /PID $8 /T /F'
      Pop $0
    ${EndIf}
  ${EndIf}
!macroend

Function .onInit
  !insertmacro KILL_RUNNING
FunctionEnd

Section "Tervixa Wiggle" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Drop the previous workbench bundle first. Copying over an existing dist
  ; leaves stale hashed assets (index-*.js) and any leftover dist.bak beside
  ; the new build, which makes a reinstall serve the old UI.
  RMDir /r "$INSTDIR\app\apps\desktop-ui\dist"
  RMDir /r "$INSTDIR\app\apps\desktop-ui\dist.bak"
  Delete "$INSTDIR\app\apps\desktop-ui\dist.bak"
  ClearErrors

  File /r "stage\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Tervixa Wiggle"
  CreateShortcut "$SMPROGRAMS\Tervixa Wiggle\Tervixa Wiggle.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortcut "$SMPROGRAMS\Tervixa Wiggle\Uninstall Tervixa Wiggle.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Tervixa Wiggle.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  WriteRegStr HKCU "${UNINST_DATA}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "https://tervixa.in"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" 120000
SectionEnd

Section "Uninstall"
  !insertmacro KILL_RUNNING

  Delete "$DESKTOP\Tervixa Wiggle.lnk"
  Delete "$SMPROGRAMS\Tervixa Wiggle\Tervixa Wiggle.lnk"
  Delete "$SMPROGRAMS\Tervixa Wiggle\Uninstall Tervixa Wiggle.lnk"
  RMDir "$SMPROGRAMS\Tervixa Wiggle"

  RMDir /r "$INSTDIR"
  Delete "$INSTDIR\Uninstall.exe"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "${UNINST_DATA}"

  IfSilent userDataDone
  MessageBox MB_YESNO|MB_ICONQUESTION "Also delete your Tervixa Wiggle settings, installed plugins and remembered memory?$\r$\n$\r$\nChoose No to keep them for a future install." IDYES deleteUserData
  Goto userDataDone

  deleteUserData:
    RMDir /r "$LOCALAPPDATA\Tervixa Wiggle"
    Delete "$PROFILE\.wiggle\settings.json"
    Delete "$PROFILE\.wiggle\memory.json"
    Delete "$PROFILE\.wiggle\state.json"
    RMDir /r "$PROFILE\.wiggle\plugins"
    RMDir /r "$PROFILE\.wiggle\snapshots"
    RMDir /r "$PROFILE\.wiggle\blobs"
    RMDir "$PROFILE\.wiggle"

  userDataDone:
SectionEnd
