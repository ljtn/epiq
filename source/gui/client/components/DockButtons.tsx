import {AsideDock} from '../lib/aside-dock';
import {IconButton, ICON_SIZE} from './IconButton';
import {IconDockBottom} from './IconDockBottom';
import {IconDockRight} from './IconDockRight';

/** Which edge the panel docks to, both choices shown at once. */
export const DockButtons = ({
	dock,
	onDock,
}: {
	dock: AsideDock;
	onDock: (next: AsideDock) => void;
}) => (
	<>
		<IconButton
			title="Dock to bottom"
			pressed={dock === 'bottom'}
			onClick={() => onDock('bottom')}
		>
			<IconDockBottom size={ICON_SIZE} />
		</IconButton>
		<IconButton
			title="Dock to right"
			pressed={dock === 'right'}
			onClick={() => onDock('right')}
		>
			<IconDockRight size={ICON_SIZE} />
		</IconButton>
	</>
);
