// Pasted folder paths are data passed to Read-Host, never interpolated into code.
export const claudeHookLaunchCommand = `$folder = Read-Host 'Paste the profile folder path (Enter to cancel)'
if (-not [string]::IsNullOrWhiteSpace($folder)) {
  $settings = [System.IO.Path]::Combine($folder, 'settings.json')
  if (Test-Path -LiteralPath $settings -PathType Leaf) {
    claude --settings $settings
  } else {
    Write-Error 'settings.json was not found in that folder.'
  }
}`;
