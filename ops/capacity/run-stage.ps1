param(
    [Parameter(Mandatory)][string]$Project,
    [Parameter(Mandatory)][string]$Label,
    [ValidateSet('closed', 'arrival')][string]$Mode = 'closed',
    [int]$Load = 8,
    [int]$Seconds = 180
)
$ErrorActionPreference = 'Stop'
if ($Project -notmatch '^filspay-capacity-[a-z0-9-]+$' -or $Label -notmatch '^[A-Za-z0-9_-]+$' -or $Load -lt 1 -or $Seconds -lt 1) {
    throw 'Use a dedicated filspay-capacity-* project and a unique alphanumeric stage label.'
}
$capacityRoot = Split-Path $PSScriptRoot -Parent
$capacityRepo = Split-Path $capacityRoot -Parent
Push-Location $capacityRepo
try {
    $capacityTokens = if ($Mode -eq 'arrival') { $Load * $Seconds } else { $Load * $Seconds * 12 }
    if ($capacityTokens -gt 200000) { throw 'Split this stage; fixture limit is 200000.' }
    & docker compose --env-file ops/capacity/.env -p $Project -f ops/capacity/compose.yml run --rm prepare node scripts/checkout-capacity-prepare.mjs $Label $Mode $Load $Seconds $capacityTokens |
        Set-Content "ops/capacity/runtime/$Label-fixture-metadata.txt"
    if ($LASTEXITCODE -ne 0) { throw 'Fixture preparation failed; no load was started.' }
    & node scripts/checkout-capacity.mjs "ops/capacity/runtime/$Label.json" |
        Set-Content "ops/capacity/runtime/$Label-result.json"
    if ($LASTEXITCODE -ne 0) { throw 'Benchmark failed; no capacity conclusion.' }
    Write-Output "Result: ops/capacity/runtime/$Label-result.json"
} finally { Pop-Location }
