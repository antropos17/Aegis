import { record, records, type RecordData } from './host';

function isCatalogRecord(value: unknown): value is RecordData {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Admit both catalog populations before either replaces reliable rows.
 * @param database Bundled catalog reply, wrapped or an array
 * @param user Custom catalog reply
 * @returns The accepted bundled and custom populations
 * @since 0.19.2
 */
export function catalogReadPopulations(
  database: unknown,
  user: unknown,
): { base: RecordData[]; custom: RecordData[] } {
  const envelope = record(database);
  const base = Array.isArray(database) ? database : envelope.agents;
  if (
    envelope.success === false ||
    record(user).success === false ||
    !Array.isArray(base) ||
    !Array.isArray(user) ||
    !base.every(isCatalogRecord) ||
    !user.every(isCatalogRecord)
  )
    throw new Error('Catalog reply is invalid');
  return { base: records(base), custom: records(user) };
}
