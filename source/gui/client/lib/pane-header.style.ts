/**
 * How far below the timeline the row at the top of each pane sits.
 *
 * Two of them run across the window — the log pane's fields and the ticket
 * panel's ref and buttons — and they are read as one line, so the inset that
 * places them is one number rather than two. The board between them keeps no
 * inset: its columns start at the panes' own top edge, and each lane's header
 * carries the gap above its title within the row it stands in.
 *
 * Shallower than a pane's sides: what sits here is a row of controls read
 * against the rows beside it, not prose needing room around it.
 */
export const PANE_HEADER_INSET = 8;
