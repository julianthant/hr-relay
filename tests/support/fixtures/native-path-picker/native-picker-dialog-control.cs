using System;
using System.Runtime.InteropServices;
using System.Text;

public sealed class NativePickerButton
{
    public long Dialog { get; private set; }
    public long Handle { get; private set; }
    public long Parent { get; private set; }
    public uint ProcessId { get; private set; }
    public int ControlId { get; private set; }
    public string Class { get; private set; }
    public bool Enabled { get; private set; }

    public NativePickerButton(IntPtr dialog, IntPtr handle, IntPtr parent, uint processId, int controlId, string windowClass, bool enabled)
    {
        Dialog = dialog.ToInt64(); Handle = handle.ToInt64(); Parent = parent.ToInt64();
        ProcessId = processId; ControlId = controlId; Class = windowClass; Enabled = enabled;
    }
}

public static class NativePickerDialogControl
{
    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern IntPtr GetDlgItem(IntPtr dialog, int controlId);
    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll", ExactSpelling = true)]
    private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll", ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr SendMessageTimeoutW(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam,
        uint flags, uint timeout, out UIntPtr result);

    private static uint Owner(IntPtr window)
    {
        uint processId;
        if (GetWindowThreadProcessId(window, out processId) == 0) throw new InvalidOperationException("NATIVE_PICKER_HWND_UNAVAILABLE");
        return processId;
    }

    private static string WindowClass(IntPtr window)
    {
        StringBuilder value = new StringBuilder(128);
        if (GetClassNameW(window, value, value.Capacity) == 0) throw new InvalidOperationException("NATIVE_PICKER_CLASS_UNAVAILABLE");
        return value.ToString();
    }

    public static NativePickerButton InspectOpenButton(IntPtr dialog, uint expectedProcessId)
    {
        if (Owner(dialog) != expectedProcessId || WindowClass(dialog) != "#32770")
            throw new InvalidOperationException("NATIVE_PICKER_DIALOG_OWNER_MISMATCH");
        IntPtr button = GetDlgItem(dialog, 1);
        if (button == IntPtr.Zero) return null;
        uint processId = Owner(button);
        if (processId != expectedProcessId) throw new InvalidOperationException("NATIVE_PICKER_OPEN_OWNER_MISMATCH");
        IntPtr parent = GetAncestor(button, 1);
        if (parent != dialog) throw new InvalidOperationException("NATIVE_PICKER_OPEN_PARENT_MISMATCH");
        int controlId = GetDlgCtrlID(button);
        if (controlId != 1) throw new InvalidOperationException("NATIVE_PICKER_OPEN_ID_MISMATCH");
        string windowClass = WindowClass(button);
        if (windowClass != "Button") throw new InvalidOperationException("NATIVE_PICKER_OPEN_CLASS_MISMATCH");
        return new NativePickerButton(dialog, button, parent, processId, controlId, windowClass, IsWindowEnabled(button));
    }

    public static ulong SelectFile(IntPtr dialog, uint expectedProcessId)
    {
        NativePickerButton button = InspectOpenButton(dialog, expectedProcessId);
        if (button == null || !button.Enabled) throw new InvalidOperationException("NATIVE_PICKER_OPEN_CONTROL_NOT_READY");
        UIntPtr result;
        if (SendMessageTimeoutW(dialog, 0x0111, new UIntPtr(1), new IntPtr(button.Handle), 0x0003, 1000, out result) == IntPtr.Zero)
            throw new InvalidOperationException("NATIVE_PICKER_WM_COMMAND_FAILED");
        return result.ToUInt64();
    }
}
