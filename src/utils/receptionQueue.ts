import type { ReceptionEntry } from '../types';

/** The live listener may deliver the saved ticket before the save resolves.
 * Keep that server copy (including newer status changes) instead of appending
 * a duplicate or replacing it with the original Waiting ticket.
 */
export function includeRegisteredVisitor(queue: ReceptionEntry[], entry: ReceptionEntry): ReceptionEntry[] {
  return queue.some((current) => current.id === entry.id) ? queue : [entry, ...queue];
}
