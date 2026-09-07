import {useEffect, useMemo, useRef, useState} from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {matchItems} from '../lib/commands/command-match';
import {commandRank} from '../lib/commands/command-registry';
import {
	CommandArgument,
	CommandContext,
	GuiCommand,
} from '../lib/commands/command.model';
import {CommandPaletteRow} from './CommandPaletteRow';

// The second step of a two-stage command: which command it is for, and what it
// offered. Held rather than recomputed, so a board update mid-choice cannot
// swap the list under the pointer.
type ArgumentStep = {command: GuiCommand; options: CommandArgument[]};

const MAX_ROWS = 8;

export const CommandPalette = ({
	commands,
	context,
	recentIds,
	onRun,
	onClose,
}: {
	commands: GuiCommand[];
	context: CommandContext;
	recentIds: readonly string[];
	// Told what ran, so the caller can remember it. Fired for the command, not
	// for the argument: what you reach for again is "add a tag", not "add gui".
	onRun: (command: GuiCommand) => void;
	onClose: () => void;
}) => {
	const [query, setQuery] = useState('');
	const [step, setStep] = useState<ArgumentStep | null>(null);
	const [selected, setSelected] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const rank = useMemo(() => commandRank(context), [context]);

	const matches = useMemo(() => {
		if (!step) return matchItems(commands, query, {recentIds, rank});

		const found = matchItems(step.options, query);

		// A name that is not on the list yet, offered last so it never displaces
		// an existing one under a finger already reaching for Enter.
		const fresh = step.command.freeTextArgument?.(query);
		const exists = found.some(
			match => match.item.title.toLowerCase() === query.trim().toLowerCase(),
		);

		return fresh && !exists
			? [...found, {item: {...fresh, hint: 'new'}, hits: [], score: 0}]
			: found;
	}, [step, query, commands, recentIds, rank]);

	// Whatever the query does to the list, the highlight belongs on a row that
	// is in it.
	useEffect(() => {
		setSelected(0);
	}, [query, step]);

	useEffect(() => {
		inputRef.current?.focus();
	}, [step]);

	// Keeps the highlighted row on screen when it is moved by the keyboard,
	// which is the only way it can leave the visible window.
	useEffect(() => {
		listRef.current?.children[selected]?.scrollIntoView({block: 'nearest'});
	}, [selected]);

	const runMatch = (index: number) => {
		const match = matches[index];
		if (!match) return;

		if (step) {
			step.command.run(context, match.item as CommandArgument);
			onRun(step.command);
			onClose();
			return;
		}

		const command = match.item as GuiCommand;
		if (command.unavailable(context)) return;

		// A command that takes an argument opens its list rather than firing:
		// the palette stays open and becomes the second step.
		const options = command.getArguments?.(context);
		if (options) {
			setStep({command, options});
			setQuery('');
			return;
		}

		command.run(context);
		onRun(command);
		onClose();
	};

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			// Out of the argument list first, out of the palette second — Escape
			// undoes one step at a time.
			return step ? setStep(null) : onClose();
		}

		if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
			event.preventDefault();
			return setSelected(current => Math.min(current + 1, matches.length - 1));
		}

		if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
			event.preventDefault();
			return setSelected(current => Math.max(current - 1, 0));
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			return runMatch(selected);
		}

		// Backspace on an empty query leaves the argument list, so the way back
		// is where a reader's finger already is.
		if (event.key === 'Backspace' && step && query === '') {
			event.preventDefault();
			return setStep(null);
		}
	};

	return (
		<div
			data-testid="command-palette"
			style={{
				position: 'fixed',
				inset: 0,
				background: 'rgba(0, 0, 0, 0.35)',
				backdropFilter: 'blur(1px)',
				display: 'flex',
				alignItems: 'flex-start',
				justifyContent: 'center',
				// Below the top edge rather than centred: the list grows downward,
				// and a centred box jumps as it does.
				paddingTop: '12vh',
				zIndex: 1100,
			}}
			onMouseDown={onClose}
		>
			<div
				onMouseDown={event => event.stopPropagation()}
				onKeyDown={onKeyDown}
				style={{
					width: 'min(560px, calc(100vw - 32px))',
					background: GUI_THEME.panel,
					border: `1px solid ${GUI_THEME.edge}`,
					borderRadius: 8,
					boxShadow: '0 16px 48px rgba(0, 0, 0, 0.55)',
					overflow: 'hidden',
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						padding: '10px 12px',
						borderBottom: `1px solid ${GUI_THEME.line}`,
					}}
				>
					{step && (
						<span
							style={{
								fontSize: TEXT.label,
								color: GUI_THEME.accent,
								border: `1px solid ${GUI_THEME.line}`,
								borderRadius: 4,
								padding: '2px 6px',
								flexShrink: 0,
							}}
						>
							{step.command.title}
						</span>
					)}

					<input
						ref={inputRef}
						autoFocus
						value={query}
						onChange={event => setQuery(event.target.value)}
						placeholder={step ? 'Pick one…' : 'Type a command…'}
						aria-label="Command palette"
						style={{
							flex: 1,
							background: 'transparent',
							border: 'none',
							outline: 'none',
							color: GUI_THEME.primary,
							fontSize: TEXT.prose,
							fontFamily: 'inherit',
						}}
					/>
				</div>

				<div
					ref={listRef}
					role="listbox"
					style={{
						maxHeight: MAX_ROWS * 34,
						overflowY: 'auto',
						padding: '4px 0',
					}}
				>
					{matches.length === 0 && (
						<div
							style={{
								padding: '12px',
								fontSize: TEXT.ui,
								color: GUI_THEME.dim,
							}}
						>
							Nothing matches “{query}”
						</div>
					)}

					{matches.map((match, index) => {
						const asCommand = step ? null : (match.item as GuiCommand);
						const asArgument = step ? (match.item as CommandArgument) : null;

						return (
							<CommandPaletteRow
								key={match.item.id}
								title={asCommand?.title ?? asArgument?.title ?? ''}
								hits={match.hits}
								group={asCommand?.group}
								reason={asCommand?.unavailable(context)}
								hint={asArgument?.hint}
								color={asArgument?.color}
								hasArguments={Boolean(asCommand?.getArguments)}
								selected={index === selected}
								onHover={() => setSelected(index)}
								onRun={() => runMatch(index)}
							/>
						);
					})}
				</div>
			</div>
		</div>
	);
};
