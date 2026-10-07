Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot 'cloud-guest-bootstrap.ps1'
$source = [IO.File]::ReadAllText($sourcePath)
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'bootstrap-diagnostics-parser-failed' }
$definition = $ast.FindAll({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] }, $false) | Where-Object Name -ceq 'Get-CloudGuestBootstrapFailure'
if (@($definition).Count -ne 1) { throw 'bootstrap-failure-projection-missing' }
. ([scriptblock]::Create($definition.Extent.Text))
$outer = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
if ($outer.Count -ne 1 -or $outer[0].CatchClauses.Count -ne 1) { throw 'bootstrap-outer-boundary-missing' }
$catchBody = $outer[0].CatchClauses[0].Body.Extent.Text
$script:bootstrapChecks = 0
function CheckBootstrap([bool]$Value, [string]$Code) { if (!$Value) { throw $Code }; $script:bootstrapChecks++ }
function RefuseBootstrap { throw [InvalidOperationException]::new('PASSWORD_SENTINEL C:\PRIVATE_SENTINEL') }
function InvokeBootstrapModel([string]$Stage, [string]$Body, $Identity, $Diagnostics) {
    $bootstrapStage = $Stage; $identity = $Identity; $diagnostics = $Diagnostics; $secretCleanup = $false
    function Get-LocalUser { RefuseBootstrap }
    function Test-Path { return $false }
    function Set-ItemProperty { RefuseBootstrap }
    function New-Item { RefuseBootstrap }
    function Add-Type { RefuseBootstrap }
    function Merge-CloudGuestTaskDiagnostics { RefuseBootstrap }
    function Get-CimInstance { RefuseBootstrap }
    return & ([scriptblock]::Create('try { ' + $Body + ' } catch ' + $catchBody))
}
function StatementMatching([string]$Pattern) {
    $statement = @($outer[0].Body.Statements | Where-Object { $_.Extent.Text -match $Pattern })
    if ($statement.Count -ne 1) { throw 'bootstrap-stage-operation-missing' }; return $statement[0].Extent.Text
}
$models = @(
    @{stage='accounts';body=(StatementMatching '^\$task = Get-LocalUser')},
    @{stage='secret-cleanup';body=(StatementMatching '^Set-ItemProperty')},
    @{stage='acl-setup';body=(StatementMatching '^foreach \(\$directory')},
    @{stage='native-load';body=(StatementMatching '^Add-Type')},
    @{stage='result-diagnostics';body=(StatementMatching '^\$diagnostics = Merge-CloudGuestTaskDiagnostics')},
    @{stage='os-receipt';body=(StatementMatching '^\$os = Get-CimInstance')},
    @{stage='native-run';body='RefuseBootstrap'},
    @{stage='administrator';body='RefuseBootstrap'}
)
foreach ($model in $models) {
    $result = InvokeBootstrapModel $model.stage $model.body $null $null
    CheckBootstrap (!$result.passed -and !$result.task.passed -and !$result.launchAllowed -and $result.bootstrapFailure.stage -ceq $model.stage) 'bootstrap-stage-refusal-lost'
    $json = $result | ConvertTo-Json -Depth 8
    CheckBootstrap (!$json.Contains('PASSWORD_SENTINEL') -and !$json.Contains('PRIVATE_SENTINEL') -and
        $result.bootstrapFailure.hResult -is [int] -and $result.bootstrapFailure.line -is [int] -and $json.Length -lt 8192) 'bootstrap-private-error-exposed'
}
foreach ($closure in @($true, $false)) {
    $identity = @{passed=$false;exitCode=7;exitCodeObserved=$true;jobClosureConfirmed=$closure;pid=123;birthFileTime=[long]456}
    $diagnostics = @{task=@{passed=$true;stage='unit-test';failure=@{stage='unit-test';childExitCode=7}};taskResultStatus='verified'}
    $result = InvokeBootstrapModel 'os-receipt' 'RefuseBootstrap' $identity $diagnostics
    CheckBootstrap (!$result.task.passed -and $result.identity.exitCode -eq 7 -and $result.identity.jobClosureConfirmed -eq $closure -and
        $result.task.failure.childExitCode -eq 7 -and $result.task.stage -ceq 'unit-test') 'bootstrap-masked-native-or-task-failure'
}
$saved = $env:AEGIS_CLOUD_GUEST_LAB
try {
    $env:AEGIS_CLOUD_GUEST_LAB = 'diagnostics-fixture-invalid'
    $result = & ([scriptblock]::Create($source)) -TaskPassword 'PASSWORD_SENTINEL'
    CheckBootstrap (!$result.passed -and !$result.task.passed -and $result.bootstrapFailure.stage -ceq 'scope' -and $null -eq $result.identity) 'actual-scope-entry-refusal-lost'
} finally { $env:AEGIS_CLOUD_GUEST_LAB = $saved }
$result = InvokeBootstrapModel 'PASSWORD_SENTINEL' 'RefuseBootstrap' $null $null
CheckBootstrap ($result.bootstrapFailure.stage -ceq 'bootstrap-unknown') 'unknown-bootstrap-stage-exposed'
if ($bootstrapChecks -ne 20) { throw 'bootstrap-control-count-mismatch' }
@{passed=$true;checks=$bootstrapChecks;scope='AST-mocked-bootstrap-stages-and-actual-scope-refusal';actualLocalAccountAclOrVm=$false;launchAllowed=$false} | ConvertTo-Json -Depth 4
