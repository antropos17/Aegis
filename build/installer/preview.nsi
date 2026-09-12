; Visual-only harness: never installs files, writes registry keys or launches AEGIS.
; Compile from this directory with makensis preview.nsi.
Unicode true
RequestExecutionLevel user
Name "AEGIS installer preview"
!ifdef PREVIEW_UNINSTALL
  OutFile "../../dist/uninstaller-preview.exe"
!else
  OutFile "../../dist/installer-preview.exe"
!endif
InstallDir "C:\Apps\AEGIS"
ShowInstDetails nevershow
!define VERSION "preview"
!define BUILD_RESOURCES_DIR ".."
!define MUI_WELCOMEFINISHPAGE_BITMAP "sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "sidebar.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_ICON "installer.ico"
!define MUI_UNICON "installer.ico"
!include "observatory.nsh"

; The production builder supplies these three symbols. Preview has no launch path.
!define isUpdated '0 = 1'
!define StdUtils.ExecShellAsUser '!insertmacro PreviewNoLaunch'
!macro PreviewNoLaunch RESULT LINK VERB ARGS
  StrCpy ${RESULT} ${LINK}
!macroend
!macro skipPageIfUpdated
!macroend
!ifndef PREVIEW_UNINSTALL
  Var launchLink
!endif

!ifdef PREVIEW_UNINSTALL
  ; Render uninstall copy in a harmless installer-shaped preview window.
  !define MUI_WELCOMEPAGE_TITLE "$(ObservatoryRemove)"
  !define MUI_WELCOMEPAGE_TEXT "$(ObservatoryRemoveDetail)"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW ObservatoryWelcomeShow
  !insertmacro MUI_PAGE_WELCOME
  !insertmacro ObservatoryUninstallProgressHeader
  !insertmacro MUI_PAGE_INSTFILES
  !insertmacro customUninstallPage
  !insertmacro MUI_PAGE_FINISH
!else
  !insertmacro customWelcomePage
  !insertmacro MUI_PAGE_DIRECTORY
  !insertmacro customPageAfterChangeDir
  !insertmacro MUI_PAGE_INSTFILES
  !insertmacro customFinishPage
!endif
!insertmacro MUI_LANGUAGE "English"
!insertmacro customHeader

Function .onInit
  !ifndef PREVIEW_UNINSTALL
  StrCpy $launchLink "preview-only"
  !endif
FunctionEnd

Section "Preview only"
  DetailPrint "Visual preview — no installation is performed."
  Sleep 3000
  Sleep 3000
  Sleep 3000
SectionEnd
