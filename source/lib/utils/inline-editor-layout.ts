// Everything the inline editor spends on chrome rather than text: the ticket
// pane's right padding, the box's left margin, its border, its left padding,
// and the scrollbar column the scroll box reserves.
const CHROME_WIDTH = 6;

const MIN_GUTTER_WIDTH = 5;

// A line number followed by three spaces, every row sharing the widest
// number's width so the text stays in one column.
export const inlineEditorGutterWidth = (rowCount: number): number =>
	Math.max(MIN_GUTTER_WIDTH, String(Math.max(rowCount, 1)).length + 3);

// What is left for the row itself. A row wider than this wraps onto a second
// terminal line, which pushes the rows below it past the box's border.
export const inlineEditorRowWidth = (
	maxWidth: number,
	rowCount: number,
): number =>
	Math.max(0, maxWidth - CHROME_WIDTH - inlineEditorGutterWidth(rowCount));
