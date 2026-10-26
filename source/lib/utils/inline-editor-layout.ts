// Columns the inline editor spends on chrome: padding, margin, border and the
// scrollbar.
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

// Rows the ticket pane spends around the editor rather than on text: its own
// bottom padding, the editor's top padding, its label, and two borders.
const CHROME_ROWS = 5;

// A field below the editor costs its own row plus the blank one above it.
const FIELD_ROWS = 2;

// The `››` rows are one menu: a blank line above, then a row each.
const MENU_BLOCK_LEAD_ROWS = 1;

/**
 * Rows of text the box can draw; one too many lands on the bottom border.
 * `fieldCount` counts spaced fields, `menuCount` the `››` rows.
 */
export const inlineEditorRowCount = (
	height: number,
	fieldCount = 0,
	menuCount = 0,
): number =>
	Math.max(
		1,
		height -
			CHROME_ROWS -
			FIELD_ROWS * fieldCount -
			(menuCount > 0 ? MENU_BLOCK_LEAD_ROWS + menuCount : 0),
	);
