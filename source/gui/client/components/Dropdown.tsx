import {useEffect, useRef, useState} from 'react';
import {Button} from './Button';
import {GUI_THEME} from '../lib/gui-theme';

type DropdownItem = {
	id: string;
	label: string;
};

export const Dropdown = ({
	label,
	value,
	items,
	placeholder = 'Select...',
	onSelect,
}: {
	label?: string;
	value?: DropdownItem | null;
	items: DropdownItem[];
	placeholder?: string;
	onSelect: (id: string) => void;
}) => {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const close = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) {
				setOpen(false);
			}
		};

		document.addEventListener('mousedown', close);
		return () => document.removeEventListener('mousedown', close);
	}, []);

	return (
		<div
			ref={ref}
			style={{
				position: 'relative',
				width: 'fit-content',
				display: 'flex',
				alignItems: 'center',
				gap: 12,
			}}
		>
			{label ? (
				<span style={{color: GUI_THEME.secondary, fontSize: '12px'}}>
					{label}
				</span>
			) : null}

			<Button
				variant="ghost"
				onClick={() => setOpen(value => !value)}
				style={{
					display: 'flex',
					alignItems: 'center',
					width: 100,
				}}
			>
				<span>{value?.label ?? placeholder}</span>

				<span
					style={{
						marginLeft: 'auto',
						color: GUI_THEME.dim,
						fontSize: '12px',
						display: 'inline-block',
						transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
						transition: 'transform 120ms ease',
					}}
				>
					❯
				</span>
			</Button>

			{open && items.length > 0 ? (
				<div
					style={{
						position: 'absolute',
						top: 28,
						left: label ? 62 : 0,
						minWidth: 220,
						background: GUI_THEME.bg,
						border: `1px solid ${GUI_THEME.line}`,
						borderRadius: 8,
						boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
						padding: 6,
						zIndex: 10,
					}}
				>
					{items.map(item => {
						const selected = item.id === value?.id;

						return (
							<button
								key={item.id}
								type="button"
								onClick={() => {
									setOpen(false);
									onSelect(item.id);
								}}
								style={{
									width: '100%',
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'center',
									border: 'none',
									background: selected ? GUI_THEME.line : 'transparent',
									color: selected ? GUI_THEME.accent : GUI_THEME.primary,
									fontFamily: 'inherit',
									fontSize: 11,
									textAlign: 'left',
									padding: '8px 10px',
									borderRadius: 6,
									cursor: 'pointer',
								}}
							>
								<span>{item.label}</span>
								{selected ? <span>✓</span> : null}
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
};
