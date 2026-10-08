# Historical negative fixture: intentional R1 unbounded reopen.
function Read-CloudGuestOwnerLifetimeReceipt([string]$Path, [string]$ExpectedSid, [switch]$RequireStandardPrincipal) {
    $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $file.Length -gt 16KB) { throw 'fixed-owner-lifetime-receipt-refused' }
    $lines = [IO.File]::ReadAllLines($file.FullName)
    if ($lines.Count -ne 2) { throw 'fixed-owner-lifetime-receipt-refused' }
    if ($PSVersionTable.PSEdition -ceq 'Core') {
        $records = @($lines | ForEach-Object { ConvertFrom-Json -InputObject $_ -AsHashtable -ErrorAction Stop })
    } else {
        Add-Type -AssemblyName System.Web.Extensions
        $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $records = @($serializer.DeserializeObject($lines[0]), $serializer.DeserializeObject($lines[1]))
    }
    if (!(Test-CloudGuestOwnerLifetimeCase $records[0] $ExpectedSid $true -RequireStandardPrincipal:$RequireStandardPrincipal) -or
        !(Test-CloudGuestOwnerLifetimeCase $records[1] $ExpectedSid $false -RequireStandardPrincipal:$RequireStandardPrincipal)) { throw 'fixed-owner-lifetime-receipt-refused' }
    return @{ schemaVersion = 1; kind = 'fixed-controlled-owner-exit'; passed = $true; cases = $records;
        launchAllowed = $false; e2Qualified = $false; e3Qualified = $false; e6Qualified = $false; acceptancePassed = $false; fullE33Accepted = $false }
}