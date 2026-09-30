import type { RecordData } from './host';

export const permissionCategories = [
  'filesystem',
  'sensitive',
  'network',
  'terminal',
  'clipboard',
  'screen',
];

function object(value: unknown): value is RecordData {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Admit actual policy maps, keeping unavailable replies distinct from empty maps.
 * @param value Host map
 * @returns Validated map
 * @since 0.17.0
 */
export function permissionMap(value: unknown): RecordData {
  if (
    !object(value) ||
    Object.values(value).some(
      (policy) =>
        !object(policy) ||
        permissionCategories.some(
          (category) =>
            Object.hasOwn(policy, category) &&
            (typeof policy[category] !== 'string' ||
              !['allow', 'monitor', 'block'].includes(policy[category])),
        ),
    )
  )
    throw new Error('Permission reply is invalid');
  return value;
}

/** Admit the production permission envelope without inventing missing maps.
 * @param value Host reply
 * @returns Combined durable policies
 * @since 0.17.0
 */
export function permissionEnvelope(value: unknown): RecordData {
  if (!object(value) || value.success === false) throw new Error('Permission reply is unavailable');
  return { ...permissionMap(value.permissions), ...permissionMap(value.instancePermissions) };
}

/** Admit a loaded rule array, keeping failures distinct from a true empty array.
 * @param value Host reply
 * @returns Loaded rules
 * @since 0.17.0
 */
export function ruleReply(value: unknown): RecordData[] {
  const ids = new Set<string>();
  if (
    !Array.isArray(value) ||
    !value.every((row): row is RecordData => {
      if (
        !object(row) ||
        typeof row.id !== 'string' ||
        !row.id.trim() ||
        ids.has(row.id) ||
        (Object.hasOwn(row, 'enabled') && typeof row.enabled !== 'boolean')
      )
        return false;
      ids.add(row.id);
      return true;
    })
  )
    throw new Error('Detection rule reply is invalid');
  return value;
}

/** Compare category values independently of wire property ordering.
 * @param policy Policy values
 * @returns Stable editable snapshot
 * @since 0.17.0
 */
export function policyDraft(policy: RecordData): Record<string, string> {
  return Object.fromEntries(
    permissionCategories.map((category) => [category, String(policy[category] ?? 'monitor')]),
  );
}

/** Compare the values represented by the permission editor.
 * @param policy Policy values
 * @returns Stable snapshot string
 * @since 0.17.0
 */
export function policySnapshot(policy: RecordData): string {
  return JSON.stringify(policyDraft(policy));
}

/** Compare all durable keys in a confirmed reset reply with current readback.
 * @param policies Policy map
 * @returns Stable map snapshot
 * @since 0.17.0
 */
export function policyMapSnapshot(policies: RecordData): string {
  return JSON.stringify(
    Object.keys(policies)
      .sort()
      .map((key) => [key, policySnapshot(policies[key] as RecordData)]),
  );
}
