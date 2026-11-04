param([Parameter(Mandatory = $true)][string]$OwnedPidsJson)
$ErrorActionPreference = 'Stop'
$reason = 'json-parse'
try {
  $ownedIds = @($OwnedPidsJson | ConvertFrom-Json)
  $reason = 'pid-count'
  if ($ownedIds.Count -ne 2) { throw 'native-owned-pid-count' }
  $reason = 'pid-distinct'
  if ($ownedIds[0] -eq $ownedIds[1]) { throw 'native-owned-pid-count' }
  $births = @()
  foreach ($ownedId in $ownedIds) {
    $reason = 'pid-type'
    if ($ownedId -isnot [int] -and $ownedId -isnot [long]) { throw 'native-owned-pid-type' }
    $reason = 'pid-range'
    if ($ownedId -le 0) { throw 'native-owned-pid-range' }
    $reason = 'process-open'
    $ownedProcess = [System.Diagnostics.Process]::GetProcessById([int]$ownedId)
    try {
      $reason = 'process-start-time'
      $startTime = $ownedProcess.StartTime
      $reason = 'process-filetime'
      $fileTime = $startTime.ToFileTimeUtc()
      $reason = 'process-birth-string'
      $birth = $fileTime.ToString([System.Globalization.CultureInfo]::InvariantCulture)
      $reason = 'birth-record'
      $births += [ordered]@{ pid = [int]$ownedId; birthFileTime = $birth }
    } finally {
      $priorReason = $reason
      $reason = 'process-dispose'
      $ownedProcess.Dispose()
      $reason = $priorReason
    }
  }
  $reason = 'json-encode'
  ConvertTo-Json -InputObject $births -Compress
} catch {
  $exceptionType = $_.Exception.GetType().FullName
  $innerType = 'none'
  if ($null -ne $_.Exception.InnerException) { $innerType = $_.Exception.InnerException.GetType().FullName }
  $typePattern = '^[A-Za-z_][A-Za-z0-9_.+`]{0,159}$'
  if ($exceptionType -notmatch $typePattern) { $exceptionType = 'unavailable' }
  if ($innerType -notmatch $typePattern) { $innerType = 'unavailable' }
  $line = [int]$_.InvocationInfo.ScriptLineNumber
  [Console]::Error.WriteLine(('native-peer-birth-unproved reason={0} type={1} innerType={2} line={3}' -f $reason, $exceptionType, $innerType, $line))
  exit 1
}
