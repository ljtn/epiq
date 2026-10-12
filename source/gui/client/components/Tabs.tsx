import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {Button} from './Button';

export type TabItem<T extends string> = {
	id: T;
	label: string;
	count?: number;
};

type Props<T extends string> = {
	activeTab: T;
	tabs: TabItem<T>[];
	onChange: (tab: T) => void;
	// False in a panel too narrow to hold five tabs and their counts on one
	// line. The count is the first thing to go: a tab whose name has wrapped
	// under its own number is harder to read than one without the number.
	showCounts?: boolean;
};

export const Tabs = <T extends string>({
	activeTab,
	tabs,
	onChange,
	showCounts = true,
}: Props<T>) => (
	// The same small square every control in the GUI is, the open one on the
	// raised ground: a row of tabs reads as the row of controls it is, not as
	// a web page's underlined links.
	// Buttons, not ARIA tabs: a tablist promises arrow-key movement between
	// its tabs, which these do not do, and every test reaches them as buttons.
	<div
		style={{
			display: 'flex',
			gap: 4,
			marginBottom: 14,
			paddingBottom: 10,
			borderBottom: `1px solid ${GUI_THEME.line}`,
		}}
	>
		{tabs.map(tab => {
			const active = tab.id === activeTab;

			return (
				<Button
					key={tab.id}
					aria-pressed={active}
					variant="ghost"
					onClick={() => onChange(tab.id)}
					style={{
						// Only set when on: an `undefined` here would unset the
						// Button's own ground and let the browser's grey through.
						...(active ? {background: GUI_THEME.raised} : {}),
						color: active ? GUI_THEME.primary : GUI_THEME.secondary,
						padding: '4px 10px',
						fontSize: TEXT.meta,
					}}
				>
					{tab.label}
					{showCounts && typeof tab.count === 'number' && (
						<span
							style={{color: tab.count ? GUI_THEME.secondary : GUI_THEME.dim}}
						>
							{' '}
							({tab.count})
						</span>
					)}
				</Button>
			);
		})}
	</div>
);
