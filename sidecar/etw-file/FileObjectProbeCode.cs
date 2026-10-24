namespace Aegis.EtwLifecycle;

// Closed metadata for the standalone capability probe; no native values or text.
internal enum FileObjectProbeCode
{
    Qualified,
    PlatformRefused,
    ProfileRefused,
    ProcessOpenRefused,
    KnownOpenRefused,
    IndependentOpenRefused,
    FileTypeRefused,
    DuplicateRefused,
    DuplicateInvalid,
    DuplicateComparisonRefused,
    IndependentComparisonRefused,
    FileIdentityRefused,
    FileIdentityMismatch,
    InventoryLibraryRefused,
    InventoryExportRefused,
    InventoryQueryRefused,
    InventoryAccessRefused,
    InventorySizeRefused,
    InventoryLayoutRefused,
    InventoryObjectRefused,
    InventoryLimitRefused,
    InventoryKnownMissing,
    InventoryCopyMissing,
    InventoryIndependentMissing,
    InventorySameObjectMismatch,
    InventoryDistinctObjectMismatch,
    EntryPointUnavailable,
    LibraryUnavailable,
    NativeOperationRefused
}
