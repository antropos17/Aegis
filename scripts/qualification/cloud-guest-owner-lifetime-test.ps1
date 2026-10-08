Set-StrictMode -Version Latest

# Test-only JSON conversion; supports the maintained inbox PowerShell 5.1 preflight.
function ConvertFrom-CloudGuestOwnerLifetimeTestJson([string]$Text) {
    if ($PSVersionTable.PSEdition -ceq 'Core') { return ConvertFrom-Json -InputObject $Text -AsHashtable }
    Add-Type -AssemblyName System.Web.Extensions
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $raw = $serializer.DeserializeObject($Text)
    if ($raw -isnot [Collections.IDictionary]) { throw 'owner-lifetime-test-json-object-required' }
    $result = @{}
    foreach ($key in $raw.Keys) { $result[$key] = $raw[$key] }
    return $result
}
