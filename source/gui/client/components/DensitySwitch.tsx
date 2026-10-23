import {useCardDensityView, useToggleCardDensity} from '../lib/card-density';
import {GUI_THEME} from '../lib/gui-theme';
import {mutedStyle} from './ScrubberSelects';
import {Switch} from './Switch';

// The board's card density as a choice between two named sides, the switch
// between them: Wide to the left, Dense to the right, the names the TUI's view
// modes go by. Neither is "off", so the switch is lit at both ends and the
// knob says which; either word picks its side too. Muted and still with the
// rest of its row while the board is not connected.
export const DensitySwitch = ({disabled = false}: {disabled?: boolean}) => {
	const dense = useCardDensityView().density === 'dense';
	const onToggle = useToggleCardDensity();

	const side = (label: string, active: boolean) => (
		<button
			type="button"
			data-testid={`card-density-${label.toLowerCase()}`}
			aria-pressed={active}
			disabled={disabled}
			// The switch is the one keyboard stop; the words are for the pointer.
			tabIndex={-1}
			onClick={() => {
				if (!active) onToggle();
			}}
			style={{
				border: 'none',
				background: 'transparent',
				padding: 0,
				// The scope buttons' type, beside which it sits.
				fontSize: 11,
				// The scope buttons' inks: the switch's knob is the mark, as their
				// underline is, and the words stay text.
				color: active ? GUI_THEME.primary : GUI_THEME.dim,
				cursor: disabled ? 'not-allowed' : active ? 'default' : 'pointer',
				...(disabled ? mutedStyle : {}),
				transition: 'color 120ms ease',
			}}
		>
			{label}
		</button>
	);

	return (
		<span style={{display: 'inline-flex', alignItems: 'center', gap: 8}}>
			{side('Wide', !dense)}
			<Switch
				testId="card-density-toggle"
				checked={dense}
				onChange={onToggle}
				// Lit at either end: neither side is "on".
				either
				size="small"
				disabled={disabled}
			/>
			{side('Dense', dense)}
		</span>
	);
};
