/**
 * How far below the timeline the row at the top of each pane sits.
 *
 * Three of them run across the window — the log pane's fields, the board's own
 * switcher, and the ticket panel's ref and buttons — and they are read as one
 * line, so the inset that places them is one number rather than three. The log
 * pane had none at all and sat thirteen pixels above the other two.
 *
 * Shallower than a pane's sides: what sits here is a row of controls read
 * against the rows beside it, not prose needing room around it.
 */
export const PANE_HEADER_INSET = 10;
