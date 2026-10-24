/** Select persisted audit rows linked to the actual object-read event.
 * @param {object[]} rows Canonical entries read from the owned profile.
 * @param {object} event Actual operational object-read event.
 * @returns {object[]} Matching canonical entries.
 * @since v0.20.1
 */
export function matchingNativeAuditRows(rows, event) {
  const object = event?.object;
  const objectKeys = ['bindingId', 'objectKey', 'scopeGeneration', 'policyGeneration'];
  if (
    !Array.isArray(rows) ||
    event?.observationKind !== 'bound-object-read' ||
    !Number.isSafeInteger(event.pid) ||
    event.pid <= 0 ||
    !['eventId', 'instanceId', 'createTime100ns'].every(
      (key) => typeof event[key] === 'string' && event[key].length > 0,
    ) ||
    !objectKeys.every((key) => typeof object?.[key] === 'string' && object[key].length > 0)
  )
    return [];
  return rows.filter(
    (row) =>
      row?.type === 'file-access' &&
      row.pid === event.pid &&
      row.instanceId === event.instanceId &&
      row.path === '' &&
      row.details?.eventId === event.eventId &&
      row.details.createTime100ns === event.createTime100ns &&
      objectKeys.every((key) => row.details.boundObject?.[key] === object[key]),
  );
}
