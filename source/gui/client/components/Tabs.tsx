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
	// False where the counts would wrap under the names.
	showCounts?: boolean;
};

export const Tabs = <T extends string>({
	activeTab,
	tabs,
	onChange,
	showCounts = true,
}: Props<T>) => (
	// Buttons, not ARIA tabs: a tablist promises arrow-key movement these lack.
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
