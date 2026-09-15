import {AsideDock} from '../lib/aside-dock';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {DockButtons} from './DockButtons';
import {ICON_SIZE} from './IconButton';
import {IconDockBottom} from './IconDockBottom';
import {IconDockRight} from './IconDockRight';
import {KebabMenu} from './KebabMenu';

/**
 * Where the panel attaches, behind a trigger that shows the side in force.
 *
 * Out of the header proper on purpose: it is a preference set once, and the
 * row beside the close button is for things you reach for every ticket. The
 * trigger wears the current dock's icon rather than three dots, so the header
 * answers "where is it now" without a click; inside, both sides show at once.
 */
export const PanelDockMenu = ({
	dock,
	onDock,
}: {
	dock: AsideDock;
	onDock: (next: AsideDock) => void;
}) => (
	<KebabMenu
		testId="panel-menu"
		title={dock === 'bottom' ? 'Docked to bottom' : 'Docked to right'}
		icon={
			dock === 'bottom' ? (
				<IconDockBottom size={ICON_SIZE} />
			) : (
				<IconDockRight size={ICON_SIZE} />
			)
		}
	>
		{close => (
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 12,
					padding: '4px 6px',
				}}
			>
				<span
					style={{
						color: GUI_THEME.secondary,
						fontSize: TEXT.label,
						textTransform: 'uppercase',
						letterSpacing: '0.08em',
					}}
				>
					Dock
				</span>

				<span style={{display: 'inline-flex', gap: 2}}>
					<DockButtons
						dock={dock}
						onDock={next => {
							onDock(next);
							close();
						}}
					/>
				</span>
			</div>
		)}
	</KebabMenu>
);
