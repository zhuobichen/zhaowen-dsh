/**
 * What the meter last made of DeepSeek's answer: the number when there is one,
 * and otherwise the reason there is not.
 *
 * `amount` and `atMs` always travel together, and `atMs` is the time the
 * reading was taken, never the time of a later failure. A failed refresh keeps
 * the last good amount and its own time, so the age beside it stays honest
 * about how old the number is.
 */
export type Reading = {
  /** `pending` until the first answer; `ok` when a number came back. */
  kind: 'pending' | 'ok' | 'no-key' | 'refused' | 'failed'
  /** The amount as DeepSeek spelled it, with its currency, or null. */
  amount: string | null
  /** The same balance as a number, for the hourly strip; null when there is none. */
  total: number | null
  /** When the reading was taken, in milliseconds since the epoch; 0 before the first one. */
  atMs: number
  /** One phrase saying why there is no number, or what went wrong on a refresh. */
  note: string | null
  /** Spending of each of the last whole hours, oldest first; null for an hour not watched. */
  hours: (number | null)[]
}

/**
 * One balance reading, kept in the plugin's store so the strip can be summed
 * across sessions: the meter only knows what it watched.
 */
export type Sample = {
  /** When the reading was taken, in milliseconds since the epoch. */
  atMs: number
  /** The balance then, as a number. */
  total: number
}
