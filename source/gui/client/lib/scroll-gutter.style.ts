/**
 * A scrolling pane's right edge, pulled out into its panel's padding so the
 * scrollbar sits in the gutter instead of against the content.
 *
 * Half the padding, and the same half given back: the bar is drawn at the
 * pane's own edge, so pulling out by half puts it between the content and the
 * panel's edge, and the padding returns the content to exactly where it was.
 *
 * One rule for both panes that do this — the board's columns and the panel on
 * the right — so a change to either one's padding carries its scrollbar with it.
 */
export const scrollGutter = (panelPadding: number) => ({
	marginRight: -panelPadding / 2,
	paddingRight: panelPadding / 2,
});
