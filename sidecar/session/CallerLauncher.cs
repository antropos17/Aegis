using System;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Inactive internal primitive. Trusted-code image descriptors are not installation authority.
    internal static class CallerLauncher
    {
        internal sealed class Instance : IDisposable
        {
            private readonly object gate = new object();
            private readonly CallerLauncherNative.Created created;
            private readonly AppContainerExecutable.PinnedFile image;
            internal readonly CallerRegistration Registration;
            private bool disposed;
            internal SafeFileHandle Process { get { return created.Process; } }
            internal SafeFileHandle Thread { get { return created.Thread; } }
            internal uint Pid { get { return created.Pid; } }

            internal Instance(CallerLauncherNative.Created child, AppContainerExecutable.PinnedFile selected,
                CallerRegistration registration)
            { created = child; image = selected; Registration = registration; }

            internal void CheckCurrent()
            {
                lock (gate)
                lock (Registration.Gate)
                {
                    CallerNative.Require(!disposed && image.IsPinned);
                    Registration.CheckCurrent(); CallerLauncherNative.CheckCreated(created);
                    CallerNative.Require(image.MatchesProcessImage(created.Process.DangerousGetHandle()));
                }
            }

            public void Dispose()
            {
                lock (gate)
                {
                    if (disposed) return;
                    disposed = true;
                    try { try { Registration.Dispose(); } finally { CallerLauncherNative.Stop(created); } }
                    finally { created.Dispose(); image.Dispose(); }
                }
            }
        }

        // No wire-selected arguments/bootstrap/environment and no production entrypoint.
        // The primary token, inherited environment and runtime dependencies remain unqualified.
        internal static Instance Start(string fixedImage, int expectedSize, string expectedHash,
            string session, CallerLauncherNative native = null)
        {
            CallerNative.Require(!CallerNative.HasThreadToken() && fixedImage != null && fixedImage.Length <= 2048 &&
                fixedImage.Split('\\').Length <= 32 && expectedSize > 0 && expectedSize <= 4 * 1024 * 1024 &&
                Regex.IsMatch(expectedHash ?? "", "\\A[a-f0-9]{64}\\z"));
            // Reuse the existing held-file identity/hash/no-follow implementation unchanged.
            var image = AppContainerExecutable.Open(fixedImage, expectedSize, expectedHash);
            CallerLauncherNative.Created created = null; CallerRegistration registration = null;
            bool transferred = false;
            try
            {
                created = (native ?? new CallerLauncherNative()).Create(fixedImage);
                CallerLauncherNative.CheckCreated(created);
                CallerNative.Require(image.IsPinned && image.MatchesProcessImage(created.Process.DangerousGetHandle()));
                registration = new CallerRegistration(created.Process.DangerousGetHandle(), session);
                lock (registration.Gate)
                {
                    registration.CheckCurrent(); CallerLauncherNative.CheckCreated(created);
                    CallerNative.Require(image.IsPinned && image.MatchesProcessImage(created.Process.DangerousGetHandle()));
                    // Exactly one initial suspension. Zero would mean child execution was already possible.
                    CallerNative.Require(CallerLauncherNative.ResumeThread(created.Thread) == 1);
                }
                var result = new Instance(created, image, registration); transferred = true; return result;
            }
            finally
            {
                if (!transferred)
                {
                    try { if (registration != null) registration.Dispose(); }
                    finally
                    {
                        try { if (created != null) CallerLauncherNative.Stop(created); }
                        finally { if (created != null) created.Dispose(); image.Dispose(); }
                    }
                }
            }
        }
    }
}
