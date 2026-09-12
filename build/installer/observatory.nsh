; Observatory's neutral light surfaces. Keep native controls, focus and DPI scaling.
; electron-builder still owns installation, elevation, updates and profile retention.
!include "MUI2.nsh"

ManifestDPIAware true
!define MUI_BGCOLOR "FAFAF8"
!define MUI_TEXTCOLOR "272925"
!define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH AspectFitHeight
!define MUI_UNWELCOMEFINISHPAGE_BITMAP_STRETCH AspectFitHeight
!define MUI_HEADERIMAGE_BITMAP_STRETCH AspectFitHeight
!ifdef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.ObservatoryGUIInit
!else
  !define MUI_CUSTOMFUNCTION_GUIINIT ObservatoryGUIInit
!endif
!define MUI_DIRECTORYPAGE_TEXT_TOP "$(ObservatoryDirectory)"

!macro customHeader
  ; ChangeUI (inside MUI page declarations) replaces dialog fonts. Apply last.
  SetFont /LANG=${LANG_ENGLISH} "Segoe UI" 10
  Caption "AEGIS ${VERSION}"
  UninstallCaption "AEGIS ${VERSION}"
  BrandingText "AEGIS  /  ${VERSION}"
  !include "${BUILD_RESOURCES_DIR}\installer\strings.nsh"
  LangString ^NextBtn ${LANG_ENGLISH} "&Continue"
  LangString ^BackBtn ${LANG_ENGLISH} "&Back"
  ; Page-owned handles are declared by MUI before this hook is expanded.
  !ifdef BUILD_UNINSTALLER
    !insertmacro ObservatoryWindow "un."
  !else
    !insertmacro ObservatoryWindow ""
  !endif
!macroend

!macro customWelcomePage
  ; Auto-updates retain the builder's skip behavior, including silent installs.
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "$(ObservatoryWelcome)"
  !define MUI_WELCOMEPAGE_TEXT "$(ObservatoryWelcomeDetail)"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW ObservatoryWelcomeShow
  !insertmacro MUI_PAGE_WELCOME
  ; The builder's custom install-mode page does not consume MUI page headers.
  ; These therefore belong to the following directory page.
  !define MUI_PAGE_HEADER_TEXT "Choose a location"
  !define MUI_PAGE_HEADER_SUBTEXT "Select the folder for AEGIS."
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_HEADER_TEXT "Installing AEGIS"
  !define MUI_PAGE_HEADER_SUBTEXT "Copying application files. AEGIS will be ready shortly."
!macroend

!macro customFinishPage
  ; Match electron-builder's unelevated launch and --updated argument contract.
  !ifndef HIDE_RUN_AFTER_FINISH
    Function ObservatoryStartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION ObservatoryStartApp
    !define MUI_FINISHPAGE_RUN_TEXT "$(ObservatoryRun)"
  !endif
  !define MUI_FINISHPAGE_TITLE "$(ObservatoryReady)"
  !define MUI_FINISHPAGE_TEXT "$(ObservatoryReadyDetail)"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW ObservatoryFinishShow
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(ObservatoryRemove)"
  !define MUI_WELCOMEPAGE_TEXT "$(ObservatoryRemoveDetail)"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ObservatoryWelcomeShow
  !insertmacro MUI_UNPAGE_WELCOME
  !insertmacro ObservatoryUninstallProgressHeader
!macroend

!macro ObservatoryUninstallProgressHeader
  !define MUI_PAGE_HEADER_TEXT "Uninstalling AEGIS"
  !define MUI_PAGE_HEADER_SUBTEXT "Removing the application. Your settings and history will be kept."
!macroend

!macro customUninstallPage
  ; This hook is immediately before the builder's own uninstall finish page.
  !define MUI_FINISHPAGE_TITLE "$(ObservatoryRemoved)"
  !define MUI_FINISHPAGE_TEXT "$(ObservatoryRemovedDetail)"
  !ifdef BUILD_UNINSTALLER
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ObservatoryFinishShow
  !else
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW ObservatoryFinishShow
  !endif
!macroend

; These functions only style the outer window; no registry or install-mode changes.
!macro ObservatoryWindow PREFIX
  Var /GLOBAL ObservatoryTitleFont
  Function ${PREFIX}ObservatoryGUIInit
    CreateFont $ObservatoryTitleFont "Segoe UI" 16 600
    SetCtlColors $HWNDPARENT "272925" "F0F0EE"
    SetCtlColors $mui.Branding.Text "555952" "F0F0EE"
    SetCtlColors $mui.Branding.Background "555952" "F0F0EE"
  FunctionEnd
  Function ${PREFIX}ObservatoryWelcomeShow
    SendMessage $mui.WelcomePage.Title ${WM_SETFONT} $ObservatoryTitleFont 1
  FunctionEnd
  Function ${PREFIX}ObservatoryFinishShow
    SendMessage $mui.FinishPage.Title ${WM_SETFONT} $ObservatoryTitleFont 1
  FunctionEnd
!macroend
