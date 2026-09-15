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
