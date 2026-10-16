using System;
using System.Collections.Generic;

namespace Aegis.ProtectedSession
{
    internal interface IVmConfigurationSource { VmConfigurationObservation ReadConfiguration(); }

    // Observation only. A protected registration supplies approval of the original digest.
    internal sealed class VmConfigurationObservation
    {
        public readonly Guid VmId;
        public readonly string Identity, Profile, Digest;
        internal VmConfigurationObservation(Guid id, string identity, string profile, string digest)
        { VmId = id; Identity = identity; Profile = profile; Digest = digest; }
    }

    // Raw provider values deliberately retain their CLR types until validation.
    internal sealed class VmConfigurationData
    {
        internal Guid VmId;
        internal string Identity, SettingsPath;
        internal Dictionary<string, object> Settings;
        internal readonly List<VmConfigurationResource> Resources = new List<VmConfigurationResource>();
    }

    internal sealed class VmConfigurationResource
    {
        internal readonly string ClassName, Path;
        internal readonly Dictionary<string, object> Values;
        internal VmConfigurationResource(string name, string path, Dictionary<string, object> values)
        { ClassName = name; Path = path; Values = values; }
    }
}
