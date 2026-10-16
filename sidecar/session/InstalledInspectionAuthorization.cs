using System;

namespace Aegis.ProtectedSession
{
    // Nonserializable one-use permission for the existing built-in inspection only.
    internal sealed class InstalledInspectionAuthorization
    {
        private readonly CallerMainOperation.Context caller;
        private readonly CallerAdmission.Context admission;
        private readonly InstalledFixedOperationRegistration registration;
        private readonly InstalledOwnerRegistration installed;
        private readonly InstalledOwnerDeadline deadline;
        private readonly string requestId, callerGeneration, registrationGeneration;
        private bool consumed, failed;
        internal InstalledInspectionAuthorization(CallerMainOperation.Context original, CallerAdmission.Context admitted,
            string generation, InstalledFixedOperationRegistration registered, InstalledOwnerRegistration owner, InstalledOwnerDeadline limit)
        {
            CallerNative.Require(original != null && admitted != null && registered != null && owner != null && limit != null);
            caller = original; admission = admitted; callerGeneration = generation; registration = registered; installed = owner;
            deadline = limit; requestId = admitted.RequestId; registrationGeneration = registered.Generation;
        }
        private void CheckBinding(CallerMainOperation.Context original, CallerAdmission.Context admitted, string generation,
            InstalledFixedOperationRegistration registered, InstalledOwnerRegistration owner, InstalledOwnerDeadline limit)
        {
            CallerNative.Require(!failed && Object.ReferenceEquals(caller, original) && Object.ReferenceEquals(admission, admitted) &&
                Object.ReferenceEquals(registration, registered) && Object.ReferenceEquals(installed, owner) && Object.ReferenceEquals(deadline, limit) &&
                requestId == admitted.RequestId && callerGeneration == generation && registrationGeneration == registered.Generation);
            deadline.Check(); registration.CheckOwner(installed); deadline.Check();
        }
        internal void Consume(CallerMainOperation.Context original, CallerAdmission.Context admitted, string generation,
            InstalledFixedOperationRegistration registered, InstalledOwnerRegistration owner, InstalledOwnerDeadline limit, string operation)
        {
            try
            {
                CallerNative.Require(!consumed); CheckBinding(original, admitted, generation, registered, owner, limit);
                registration.RequireOperation(operation); consumed = true;
            }
            catch { failed = true; throw; }
        }
        internal void CheckRetained(CallerMainOperation.Context original, CallerAdmission.Context admitted, string generation,
            InstalledFixedOperationRegistration registered, InstalledOwnerRegistration owner, InstalledOwnerDeadline limit)
        {
            try { CallerNative.Require(consumed); CheckBinding(original, admitted, generation, registered, owner, limit); }
            catch { failed = true; throw; }
        }
    }
}
