param([Parameter(Mandatory = $true)][string] $ReportDirectory)
$ErrorActionPreference = 'Stop'
$runDirectory = [IO.Path]::GetFullPath($ReportDirectory)
$run = Get-Content -LiteralPath (Join-Path $runDirectory 'result.json') -Raw | ConvertFrom-Json
if ($run.mode -notin @('check-suspend', 'uac-suspend')) { throw 'A suspend-mode report is required.' }
$fromOffset = if ($run.started -is [DateTime] -or $run.started -is [DateTimeOffset]) { [DateTimeOffset]$run.started } else { [DateTimeOffset]::Parse($run.started) }
$untilOffset = if ($run.ended -is [DateTime] -or $run.ended -is [DateTimeOffset]) { [DateTimeOffset]$run.ended } else { [DateTimeOffset]::Parse($run.ended) }
$from = $fromOffset.LocalDateTime
$until = $untilOffset.LocalDateTime
$events = @()
$queries = @()
foreach ($provider in @('Microsoft-Windows-Kernel-Power', 'Microsoft-Windows-Power-Troubleshooter')) {
    $ids = if ($provider -eq 'Microsoft-Windows-Kernel-Power') { @(42, 107, 506, 507) } else { @(1) }
    try {
        $found = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = $provider; Id = $ids; StartTime = $from; EndTime = $until } -MaxEvents 65 -ErrorAction Stop)
        $queries += [ordered]@{ provider = $provider; status = 'ok'; truncated = ($found.Count -gt 64) }
        foreach ($event in @($found | Select-Object -First 64)) {
            $xml = [xml]$event.ToXml()
            $fields = [ordered]@{}
            foreach ($field in @($xml.Event.EventData.Data)) {
                if ($field.Name -in @('TargetState', 'EffectiveState', 'Reason') -and $field.InnerText -match '^[0-9]{1,10}$') {
                    $fields[$field.Name] = $field.InnerText
                }
            }
            $events += [ordered]@{ provider = $provider; id = $event.Id; utc = $event.TimeCreated.ToUniversalTime().ToString('o'); numericFields = $fields }
        }
    } catch {
        $status = if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { 'no-events' } else { 'query-failed' }
        $queries += [ordered]@{ provider = $provider; status = $status; truncated = $false }
    }
}
$powerText = (& (Join-Path ([Environment]::SystemDirectory) 'powercfg.exe') /a | Out-String)
$powerExit = $LASTEXITCODE
$context = [ordered]@{
    schema = 1; mode = $run.mode; reportSha256 = (Get-FileHash -LiteralPath (Join-Path $runDirectory 'result.json') -Algorithm SHA256).Hash
    capturedUtc = [DateTimeOffset]::UtcNow.ToString('o')
    intervalStartUtc = $fromOffset.ToUniversalTime().ToString('o'); intervalEndUtc = $untilOffset.ToUniversalTime().ToString('o')
    availableStatesAtCapture = $powerText.Substring(0, [Math]::Min(8192, $powerText.Length))
    availableStatesTruncated = ($powerText.Length -gt 8192); powercfgExitCode = $powerExit
    eventQueries = $queries; events = $events
    note = 'Scoped metadata only; capture-time capabilities do not prove which state the run entered. This file does not upgrade a failed harness report.'
}
$destination = Join-Path $runDirectory 'power-context.json'
$stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($context | ConvertTo-Json -Depth 12))
    $stream.Write($bytes, 0, $bytes.Length)
} finally { $stream.Dispose() }
Write-Output "Saved scoped power context: $destination"
