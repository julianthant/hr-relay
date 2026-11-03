param([Parameter(Mandatory = $true)][string]$OwnedPidsJson)
$ErrorActionPreference = 'Stop'
try {
  $ownedIds = @($OwnedPidsJson | ConvertFrom-Json)
  if ($ownedIds.Count -ne 2 -or $ownedIds[0] -eq $ownedIds[1]) { throw 'native-owned-pid-count' }
  $births = @()
  foreach ($ownedId in $ownedIds) {
    if ($ownedId -isnot [int] -and $ownedId -isnot [long]) { throw 'native-owned-pid-type' }
    if ($ownedId -le 0) { throw 'native-owned-pid-range' }
    $ownedProcess = [System.Diagnostics.Process]::GetProcessById([int]$ownedId)
    try {
      $births += [ordered]@{
        pid = [int]$ownedId
        birthFileTime = $ownedProcess.StartTime.ToFileTimeUtc().ToString([System.Globalization.CultureInfo]::InvariantCulture)
      }
    } finally { $ownedProcess.Dispose() }
  }
  ConvertTo-Json -InputObject $births -Compress
} catch {
  [Console]::Error.WriteLine('native-peer-birth-unproved')
  exit 1
}
