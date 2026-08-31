import {AsideDock} from '../lib/aside-dock';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {DockButtons} from './DockButtons';
import {KebabMenu} from './KebabMenu';

/**
 * Where the panel attaches, tucked behind the header's kebab.
 *
 * Out of the header proper on purpose: it is a preference set once, and the
 * row beside the close button is for things you reach for every ticket. Inside
 * the menu it still shows both sides at once, so the lit one answers "where is
 * it now" without a click.
 */
export const PanelDockMenu = ({
	dock,
	onDock,
}: {
	dock: AsideDock;
	onDock: (next: AsideDock) => void;
}) => (
	<KebabMenu testId="panel-menu" title="Panel options">
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
