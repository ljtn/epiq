import {GUI_THEME} from '../lib/gui-theme';

export type TabItem<T extends string> = {
	id: T;
	label: string;
	count?: number;
};

type Props<T extends string> = {
	activeTab: T;
	tabs: TabItem<T>[];
	onChange: (tab: T) => void;
};

export const Tabs = <T extends string>({
	activeTab,
	tabs,
	onChange,
}: Props<T>) => (
	<div
		style={{
			display: 'flex',
			gap: 6,
			marginBottom: 14,
			borderBottom: `1px solid ${GUI_THEME.line}`,
		}}
	>
		{tabs.map(tab => {
			const active = tab.id === activeTab;

			return (
				<button
					key={tab.id}
					type="button"
					onClick={() => onChange(tab.id)}
					style={{
						background: 'transparent',
						border: 'none',
						borderBottom: `1px solid ${
							active ? GUI_THEME.accent : 'transparent'
						}`,
						color: active ? GUI_THEME.primary : GUI_THEME.secondary,
						padding: '0 8px 10px',
						marginBottom: -1,
						font: 'inherit',
						fontSize: 11,
						cursor: 'pointer',
					}}
				>
					{tab.label}
					{typeof tab.count === 'number' && (
						<span
							style={{color: tab.count ? GUI_THEME.secondary : GUI_THEME.dim}}
						>
							{' '}
							({tab.count})
						</span>
					)}
				</button>
			);
		})}
	</div>
);
