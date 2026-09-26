import { record, type RecordData } from './host';

/** Validate imported signatures before writing custom definitions.
 * @param value Imported records @returns Validated records @since 0.14.1
 */
export function validateCatalog(value: unknown): RecordData[] {
  if (!Array.isArray(value) || value.length > 2000)
    throw new Error('Expected up to 2000 agent definitions');
  const ids = new Set<string>();
  return value.map((item) => {
    const agent = record(item);
    if (typeof agent.id !== 'string' || !/^[\w.-]{1,128}$/.test(agent.id) || ids.has(agent.id))
      throw new Error('Each agent needs a unique ID (letters, digits, dot, dash or underscore)');
    if (
      typeof agent.displayName !== 'string' ||
      !agent.displayName.trim() ||
      agent.displayName.length > 200
    )
      throw new Error('Each agent needs a display name');
    if (
      !Array.isArray(agent.names) ||
      !agent.names.length ||
      agent.names.some((name) => typeof name !== 'string' || !name.trim() || name.length > 256)
    )
      throw new Error('Each agent needs valid process names');
    if (
      agent.website &&
      (typeof agent.website !== 'string' || !/^https?:\/\//i.test(agent.website))
    )
      throw new Error('Product websites must use HTTP or HTTPS');
    ids.add(agent.id);
    return { ...agent, names: [...new Set(agent.names)] };
  });
}

export interface SignatureConflict {
  signature: string;
  firstOwner: string;
  firstOwnerId: string;
}

export interface CatalogRecognition {
  eligible: string[];
  shadowed: SignatureConflict[];
  skippedById: boolean;
}

/** Describe static process-name ownership in scanner order for every catalog row.
 * @param bundled Bundled definitions @param custom Saved custom definitions
 * @returns Recognition status in bundled-then-custom order @since 0.16.0
 */
export function catalogRecognition(
  bundled: RecordData[],
  custom: RecordData[],
): CatalogRecognition[] {
  const firstOwner = new Map<string, { name: string; id: string }>();
  const seenIds = new Set(bundled.map((agent) => String(agent.id)));
  return [...bundled, ...custom].map((agent, index) => {
    const result: CatalogRecognition = { eligible: [], shadowed: [], skippedById: false };
    const isCustom = index >= bundled.length;
    const id = String(agent.id);
    if (isCustom && seenIds.has(id)) {
      result.skippedById = true;
      return result;
    }
    if (isCustom) seenIds.add(id);
    const rowNames = new Set<string>();
    for (const value of Array.isArray(agent.names) ? agent.names : []) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const normalized = value.toLowerCase();
      if (rowNames.has(normalized)) continue;
      rowNames.add(normalized);
      const owner = firstOwner.get(normalized);
      if (owner) {
        result.shadowed.push({
          signature: value,
          firstOwner: owner.name,
          firstOwnerId: owner.id,
        });
      } else {
        result.eligible.push(value);
        firstOwner.set(normalized, { name: String(agent.displayName), id });
      }
    }
    return result;
  });
}
