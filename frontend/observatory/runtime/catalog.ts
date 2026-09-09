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
    return { ...agent };
  });
}
