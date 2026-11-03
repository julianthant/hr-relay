$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$authorized = $false
$window = $null
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName UIAutomationClientsideProviders
  $registration = [System.Windows.Automation.ClientSettings].GetMethod('RegisterClientSideProviderAssembly')
  $registration.Invoke($null, @([UIAutomationClientsideProviders.UIAutomationClientSideProviders].Assembly.GetName()))
  Add-Type -AssemblyName System.Windows.Forms
  if (-not [System.Windows.Forms.SystemInformation]::UserInteractive) {
    throw 'NATIVE_PICKER_DESKTOP_UNAVAILABLE: WinForms requires a UserInteractive window station'
  }
  $request = ConvertFrom-Json ([Console]::ReadLine())
  if ($request.kind -eq 'file' -and $request.action -eq 'select') { Add-Type -Path $request.shim }
  $targetPid = [int]$request.pid
  $target = [Diagnostics.Process]::GetProcessById($targetPid)
  $null = $target.Handle
  if (-not [String]::Equals($target.MainModule.FileName, $request.executable, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'NATIVE_PICKER_OWNER_MISMATCH'
  }
  [Console]::WriteLine('BOUND')
  [Console]::Out.Flush()
  if ([Console]::ReadLine() -cne 'AUTHORIZE') { throw 'NATIVE_PICKER_BINDING_NOT_AUTHORIZED' }
  $authorized = $true
  if ($target.HasExited) { throw 'NATIVE_PICKER_EXITED_BEFORE_AUTHORIZED_ENUMERATION' }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $scope = [System.Windows.Automation.TreeScope]::Descendants
  $pidCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)
  $classCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')
  $condition = New-Object System.Windows.Automation.AndCondition($pidCondition, $classCondition)

  function Check-Deadline {
    if ($watch.ElapsedMilliseconds -ge 15000) { throw 'NATIVE_PICKER_UI_DEADLINE' }
  }
  function Find-Control($window, [string]$automationId, $controlType) {
    $idCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $automationId)
    $typeCondition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $controlType)
    $matches = $window.FindAll($scope, (New-Object System.Windows.Automation.AndCondition($idCondition, $typeCondition)))
    if ($matches.Count -gt 1) { throw 'NATIVE_PICKER_AMBIGUOUS_CONTROL' }
    if ($matches.Count -eq 0) { return $null }
    $control = $matches.Item(0)
    if ($control.Current.ProcessId -ne $targetPid) { throw 'NATIVE_PICKER_CONTROL_OWNER_MISMATCH' }
    if (-not $control.Current.IsEnabled) { return $null }
    return $control
  }

  $needsFile = $request.kind -eq 'file' -and $request.action -eq 'select'
  $needsOk = $request.kind -eq 'folder' -and $request.action -ne 'cancel'
  $needsCancel = $request.action -ne 'select'
  $ok = $null
  $cancel = $null
  $fileName = $null
  $nativeOpen = $null
  $dialogHandle = [IntPtr]::Zero
  $ready = $false
  while (-not $ready) {
    Check-Deadline
    if ($target.HasExited) { throw 'NATIVE_PICKER_EXITED_BEFORE_DIALOG_READY' }
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
      [System.Windows.Automation.TreeScope]::Children, $condition)
    if ($windows.Count -gt 1) { throw 'NATIVE_PICKER_AMBIGUOUS_DIALOG' }
    if ($windows.Count -eq 1) {
      $window = $windows.Item(0)
      if ($needsOk) { $ok = Find-Control $window '1' ([System.Windows.Automation.ControlType]::Button) }
      if ($needsCancel) { $cancel = Find-Control $window '2' ([System.Windows.Automation.ControlType]::Button) }
      if ($needsFile) {
        $fileName = Find-Control $window '1148' ([System.Windows.Automation.ControlType]::Edit)
        $dialogHandle = [IntPtr]::new($window.Current.NativeWindowHandle)
        $nativeOpen = [NativePickerDialogControl]::InspectOpenButton($dialogHandle, $targetPid)
      }
      $ready = (-not $needsOk -or $null -ne $ok) -and (-not $needsCancel -or $null -ne $cancel) -and
        (-not $needsFile -or ($null -ne $fileName -and $null -ne $nativeOpen -and $nativeOpen.Enabled))
    }
    if (-not $ready) { Start-Sleep -Milliseconds 25 }
  }
  if ($needsOk) { $okInvoke = [System.Windows.Automation.InvokePattern]$ok.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) }
  if ($needsCancel) { $cancelInvoke = [System.Windows.Automation.InvokePattern]$cancel.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) }
  if ($needsFile) {
    $fileValue = [System.Windows.Automation.ValuePattern]$fileName.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($fileValue.Current.IsReadOnly) { throw 'NATIVE_PICKER_FILENAME_READ_ONLY' }
    [Console]::Error.WriteLine((@{ nativeButton = $nativeOpen } | ConvertTo-Json -Compress))
  }
  [Console]::WriteLine('READY')
  [Console]::Out.Flush()
  if ($request.action -eq 'select') {
    if ($target.HasExited) { throw 'NATIVE_PICKER_EXITED_BEFORE_ACTION' }
    if ($needsFile) {
      $fileValue.SetValue([string]$request.path)
      if ($fileValue.Current.Value -cne $request.path) { throw 'NATIVE_PICKER_FILENAME_VALUE_MISMATCH' }
    }
    if ($target.HasExited) { throw 'NATIVE_PICKER_EXITED_BEFORE_ACTION' }
    if ($needsFile) {
      $commandResult = [NativePickerDialogControl]::SelectFile($dialogHandle, $targetPid)
      [Console]::Error.WriteLine((@{ nativeCommand = @{ message = 273; controlId = 1; notification = 0; result = $commandResult } } | ConvertTo-Json -Compress))
    } else { $okInvoke.Invoke() }
  } elseif ($request.action -eq 'cancel') {
    if ($target.HasExited) { throw 'NATIVE_PICKER_EXITED_BEFORE_ACTION' }
    $cancelInvoke.Invoke()
  } elseif ($request.action -ne 'abort') { throw 'NATIVE_PICKER_UNKNOWN_ACTION' }
  while (-not $target.HasExited) {
    Check-Deadline
    Start-Sleep -Milliseconds 25
  }
  [Console]::WriteLine('DONE')
} catch {
  $failure = $_.Exception.Message
  if ($authorized) {
    try {
      if ($target.HasExited -or $null -eq $window) {
        [Console]::Error.WriteLine('NATIVE_PICKER_OWNED_DIALOG_UNAVAILABLE')
      } elseif ($window.Current.ProcessId -eq $targetPid) {
        $nodes = $window.FindAll([System.Windows.Automation.TreeScope]::Subtree,
          [System.Windows.Automation.Condition]::TrueCondition)
        $budget = 4096
        for ($index = 0; $index -lt [Math]::Min($nodes.Count, 24); $index++) {
          if ($target.HasExited) { break }
          $node = $nodes.Item($index)
          if ($node.Current.ProcessId -ne $targetPid) { continue }
          $class = [string]$node.Current.ClassName
          $type = [string]$node.Current.ControlType.ProgrammaticName
          $id = [string]$node.Current.AutomationId
          $patterns = @($node.GetSupportedPatterns() | Select-Object -First 4 | ForEach-Object { $_.ProgrammaticName })
          $record = [ordered]@{
            class = $class.Substring(0, [Math]::Min($class.Length, 64))
            type = $type.Substring(0, [Math]::Min($type.Length, 64))
            id = $id.Substring(0, [Math]::Min($id.Length, 64))
            enabled = $node.Current.IsEnabled
            patterns = $patterns
          } | ConvertTo-Json -Compress
          $bytes = [Text.Encoding]::UTF8.GetByteCount($record) + 2
          if ($bytes -gt $budget) { break }
          [Console]::Error.WriteLine($record)
          $budget -= $bytes
        }
      }
    } catch { [Console]::Error.WriteLine('NATIVE_PICKER_OWNED_DIAGNOSTICS_UNAVAILABLE') }
  }
  [Console]::Error.WriteLine($failure)
  exit 1
} finally {
  if ($null -ne $target) { $target.Dispose() }
}
