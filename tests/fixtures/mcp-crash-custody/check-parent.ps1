param([Parameter(Mandatory = $true)][string] $Parent)
$ErrorActionPreference = 'Stop'
$current = [IO.Path]::GetFullPath($Parent)
while ($true) {
  $item = Get-Item -LiteralPath $current -Force
  if (-not $item.PSIsContainer -or
      (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
    throw 'fixture-parent-unavailable'
  }
  $next = [IO.Directory]::GetParent($current)
  if ($null -eq $next) { break }
  $current = $next.FullName
}
