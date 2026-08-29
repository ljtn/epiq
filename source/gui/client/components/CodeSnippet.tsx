import {File} from '@pierre/diffs/react';
import {GUI_THEME} from '../lib/gui-theme';

// The same highlighter and theme the diff view itself renders with, so a
// snippet quoted into a comment looks like the code it was taken from rather
// than like markdown text. `name` is what infers the language, which is why
// the quoting side keeps the real file path around.
const PIERRE_THEME = 'github-dark';

export const CodeSnippet = ({
	filePath,
	snippet,
}: {
	filePath: string;
	snippet: string;
}) => (
	<div
		style={{
			marginTop: 8,
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 8,
			overflow: 'hidden',
		}}
	>
		<File
			file={{name: filePath, contents: snippet}}
			options={{
				theme: PIERRE_THEME,
				// The caption above already names the file and its line range, and
				// the snippet's own numbers would start at 1 rather than at the
				// lines it was taken from — actively misleading.
				disableFileHeader: true,
				disableLineNumbers: true,
			}}
		/>
	</div>
);
