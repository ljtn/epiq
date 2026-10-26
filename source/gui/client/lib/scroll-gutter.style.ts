/**
 * Pulls a pane's scrollbar out into half its panel's padding, and gives the
 * same half back so the content stays put.
 */
export const scrollGutter = (panelPadding: number) => ({
	marginRight: -panelPadding / 2,
	paddingRight: panelPadding / 2,
});
