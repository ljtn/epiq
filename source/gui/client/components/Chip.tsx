import {CODE_FONT} from '../lib/code-text.style';
import {GUI_THEME, TEXT} from '../lib/gui-theme';

// A small mark beside a thing that says what kind of thing it is, or how it
// stands: which repo a commit is from, whether a clone has been fetched. One
// shape wherever it is drawn, in the code face at the smallest size.
export const Chip = ({
	children,
	title,
	testId,
	style,
}: {
	children: React.ReactNode;
	title?: string;
	testId?: string;
	style?: React.CSSProperties;
}) => (
	<span
		data-testid={testId}
		title={title}
		style={{
			flexShrink: 0,
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap',
			padding: '1px 6px',
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 4,
			color: GUI_THEME.dim2,
			fontFamily: CODE_FONT,
			fontSize: TEXT.label,
			...style,
		}}
	>
		{children}
	</span>
);
