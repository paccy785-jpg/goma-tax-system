/**
 * Swallow duplicate form submissions before they reach a handler.
 *
 * A disabled submit button does not stop implicit submission: while it is
 * disabled the Enter key inside a text field still submits the form, and the
 * second press usually arrives before React has committed the render that
 * disables anything. Every create screen in this app is a form, so the check
 * belongs once, at the document, rather than in each handler where one missed
 * copy becomes a duplicated record.
 *
 * The window is deliberately short. A double-press or double-click lands inside
 * a few hundred milliseconds; an officer who reads a validation message, types
 * the missing value and presses Enter again is a new intent seconds later, and
 * must not be blocked by the previous one.
 */
const WINDOW_MS = 600;

const lastSubmitAt = new WeakMap<EventTarget, number>();

function isTrustedSubmitForm(target: EventTarget | null): target is HTMLFormElement {
  return target instanceof HTMLFormElement;
}

export function installDoubleSubmitGuard(): void {
  document.addEventListener(
    'submit',
    (event) => {
      if (!isTrustedSubmitForm(event.target)) return;
      const now = Date.now();
      const previous = lastSubmitAt.get(event.target);
      if (previous !== undefined && now - previous < WINDOW_MS) {
        // Capture phase, so React's delegated handler never sees this event.
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // Only accepted submissions move the clock, so the window is measured from
      // the request that actually ran: holding Enter down cannot lock a form out
      // indefinitely.
      lastSubmitAt.set(event.target, now);
    },
    true
  );
}
