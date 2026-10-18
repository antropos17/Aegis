namespace Aegis.EtwLifecycle;

// Finite failure checkpoints for the explicitly selected local qualification path.
// No exception text, reservation, handle, identity string or file path is emitted.
internal static class FileQualificationDiagnostic
{
    internal static int Step;
    internal static bool Enabled => Environment.GetEnvironmentVariable(FileQualificationPolicy.Variable) != null;
    // Once the child reference is accepted, preserve every existing runtime exit contract.
    internal static int Failure => Enabled && Step is > 0 and < 6 ? 128 + Step : 2;
}
