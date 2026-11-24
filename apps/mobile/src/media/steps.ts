/**
 * The upload queue's rules, apart from the phone so they can be tested: which step comes next, and
 * what a rejection does. A step names what is sent next; "done" when all is on the server.
 */
export type Step = "meta" | "thumbnail" | "preview" | "original" | "done";
export const STEPS: readonly Step[] = ["meta", "thumbnail", "preview", "original", "done"];

/** The step to send now (the stored one; anything unknown starts from the beginning, which the server takes again). */
export const nextStep = (s: unknown): Step => (STEPS.includes(s as Step) ? (s as Step) : "meta");

/** Rejections before a photo is parked as stuck. */
export const STUCK_AFTER = 3;

/** A refused step: counted; the third, or a file that is gone from the phone, parks the photo. */
export function rejected(rejections: number, fileGone = false): { rejections: number; stuck: boolean } {
  const n = rejections + 1;
  return { rejections: n, stuck: fileGone || n >= STUCK_AFTER };
}

/** What a queued photo shows: waiting, its preview on the server (the original still to come), or stuck. */
export type QueueState = "waiting" | "preview" | "stuck";
export const stateOf = (p: { step: Step; stuck: boolean }): QueueState => (p.stuck ? "stuck" : p.step === "original" || p.step === "done" ? "preview" : "waiting");
