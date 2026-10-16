#if PROTECTED_GUI_PROCESS_TEST
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Only observes the window of the still-retained original process. No desktop
// capture, input, foreground changes, process adoption or termination by PID.
public static class DesktopObservation
{
    private delegate bool EnumCallback(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    public sealed class Result {
        public bool Visible, ImageHasContent;
        public int Width, Height;
        public string Title;
    }
    public static Result Observe(ProtectedGuiProcessLease owner, string screenshot) {
        var previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (previousDpi == IntPtr.Zero) throw new InvalidDataException("desktop-dpi-context-refused");
        try { return ObserveCore(owner, screenshot); }
        finally { SetThreadDpiAwarenessContext(previousDpi); }
    }
    private static Result ObserveCore(ProtectedGuiProcessLease owner, string screenshot) {
        var before = owner.GetState();
        if (before.RootAlive != true || before.CleanupUnknown) throw new InvalidDataException("desktop-root-not-live");
        uint original = owner.ProcessIdForTest;
        if (original == 0) throw new InvalidDataException("desktop-root-not-live");
        var result = new Result();
        EnumWindows(delegate(IntPtr window, IntPtr unused) {
            uint pid;
            if (GetWindowThreadProcessId(window, out pid) == 0 || pid != original || !IsWindowVisible(window)) return true;
            var title = new StringBuilder(256); GetWindowText(window, title, title.Capacity);
            // Ignore utility windows and modal startup errors. A title alone is
            // not evidence of renderer or IPC correctness; inspect the PNG separately.
            if (title.ToString() != "AEGIS \u2014 Observatory") return true;
            Rect rect;
            if (!GetWindowRect(window, out rect)) return true;
            int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
            if (width < 640 || height < 400 || width > 4096 || height > 4096) return true;
            result.Visible = true; result.Width = width; result.Height = height; result.Title = title.ToString();
            if (!String.IsNullOrEmpty(screenshot)) {
                using (var bitmap = new Bitmap(width, height)) {
                    using (var graphics = Graphics.FromImage(bitmap)) {
                        var dc = graphics.GetHdc();
                        // PW_RENDERFULLCONTENT: include the composited Chromium surface.
                        try { if (!PrintWindow(window, dc, 2)) throw new IOException("desktop-window-capture-failed"); }
                        finally { graphics.ReleaseHdc(dc); }
                    }
                    using (var file = new FileStream(screenshot, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        bitmap.Save(file, ImageFormat.Png);
                    var colors = new HashSet<int>();
                    for (int y = 0; y < height; y += Math.Max(1, height / 64))
                        for (int x = 0; x < width; x += Math.Max(1, width / 64)) colors.Add(bitmap.GetPixel(x, y).ToArgb());
                    result.ImageHasContent = colors.Count >= 8;
                    if (!result.ImageHasContent) throw new InvalidDataException("desktop-window-empty");
                }
            }
            return false;
        }, IntPtr.Zero);
        var after = owner.GetState();
        if (after.RootAlive != true || after.CleanupUnknown) throw new InvalidDataException("desktop-root-not-live");
        return result;
    }
}
#endif
