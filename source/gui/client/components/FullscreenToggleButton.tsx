import {IconButton, ICON_SIZE} from './IconButton';
import {IconMaximize} from './IconMaximize';
import {IconMinimize} from './IconMinimize';

export const FullscreenToggleButton = ({
	isFullscreen,
	onClick,
}: {
	isFullscreen: boolean;
	onClick: () => void;
}) => (
	<IconButton
		// Named as well as titled: TooltipLayer takes the `title` away while its
		// own tooltip is open, and a click on this button leaves the pointer on
		// it — so the title is gone exactly when a caller looks for it next.
		testId="fullscreen-toggle"
		title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
		onClick={onClick}
	>
		{isFullscreen ? (
			<IconMinimize size={ICON_SIZE} />
		) : (
			<IconMaximize size={ICON_SIZE} />
		)}
	</IconButton>
);
