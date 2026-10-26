// How much room a ticket takes on the board. Wide is the card as it has
// always been, read top to bottom; dense is a line or two, scanned down a lane,
// for a board whose work is mostly done by agents and mostly glanced at.
//
// Every size either density draws at lives here, so a density is one set of
// numbers rather than a branch at each call site.

import {createContext, useContext, useState} from 'react';

export type CardDensity = 'wide' | 'dense';

export type CardMetrics = {
	// The card's box.
	padding: string;
	minHeight: number;
	radius: number;
	// Between one card and the next in a lane.
	gap: number;
	// The title's line, which the controls beside it centre on.
	titleLineHeight: number;
	titleFontSize: number;
	// The line the drop indicator draws between two cards, and its air.
	dropMargin: string;
};

export const CARD_METRICS: Record<CardDensity, CardMetrics> = {
	wide: {
		padding: '12px 18px 12px 14px',
		minHeight: 58,
		radius: 8,
		gap: 12,
		titleLineHeight: 16,
		titleFontSize: 12,
		dropMargin: '4px 8px 8px',
	},
	dense: {
		padding: '7px 11px',
		minHeight: 0,
		radius: 6,
		gap: 4,
		titleLineHeight: 15,
		titleFontSize: 12,
		dropMargin: '1px 8px 2px',
	},
};

// Between the pieces of a dense card's bottom line, and its dots.
export const DENSE_GAP = 8;
// The assignee's slot after the ref: a fixed width, so the diff after it lines
// up down a lane, sized for this many characters of the card's monospace.
export const DENSE_ASSIGNEE_CHARS = 14;
export const DENSE_ASSIGNEE_WIDTH = 86;
// Between the title and the line under it.
export const DENSE_LINE_GAP = 4;
// The target around a tag's mark, which is too small to aim at on its own.
export const DENSE_TAG_HIT = 4;
export const DENSE_MARKER_SIZE = 6;
// Tag marks a dense card shows before the rest go behind an ellipsis.
export const DENSE_MAX_TAGS = 4;

// The density in force, and where a dense card cuts its title.
export type CardDensityView = {
	density: CardDensity;
	// 1 or 2: a title cut at one line, or clamped at two.
	titleLines: 1 | 2;
	metrics: CardMetrics;
};

const WIDE: CardDensityView = {
	density: 'wide',
	titleLines: 2,
	metrics: CARD_METRICS.wide,
};

// The density in force, and the one way to change it: drawn by the cards and
// the drop line, switched from the toolbar, kept by `useCardDensity` at the top.
export const CardDensityContext = createContext<{
	view: CardDensityView;
	toggleDensity: () => void;
}>({view: WIDE, toggleDensity: () => {}});

export const useCardDensityView = (): CardDensityView =>
	useContext(CardDensityContext).view;

export const useToggleCardDensity = (): (() => void) =>
	useContext(CardDensityContext).toggleDensity;

const KEY = 'epiq.board.cardDensity';

type Stored = {density: CardDensity; titleLines: 1 | 2};

const DEFAULTS: Stored = {
	density: 'wide',
	titleLines: 1,
};

// Per viewer and per browser, like every other view choice. Storage can be
// missing or refuse a write — a private window, blocked site data — and the
// board must still draw, so both ways are guarded and fall back to defaults.
const read = (): Stored => {
	try {
		const parsed = JSON.parse(
			localStorage.getItem(KEY) ?? 'null',
		) as Partial<Stored> | null;

		return {
			density: parsed?.density === 'dense' ? 'dense' : DEFAULTS.density,
			titleLines: parsed?.titleLines === 2 ? 2 : DEFAULTS.titleLines,
		};
	} catch {
		return DEFAULTS;
	}
};

const write = (value: Stored) => {
	try {
		localStorage.setItem(KEY, JSON.stringify(value));
	} catch {
		// Kept for this page's life only.
	}
};

export const useCardDensity = () => {
	const [stored, setStored] = useState<Stored>(read);
	const update = (patch: Partial<Stored>) =>
		setStored(previous => {
			const next = {...previous, ...patch};
			write(next);
			return next;
		});

	const view: CardDensityView = {
		...stored,
		metrics: CARD_METRICS[stored.density],
	};

	return {
		view,
		toggleDensity: () =>
			update({
				density: stored.density === 'dense' ? 'wide' : 'dense',
			}),
		toggleTitleLines: () =>
			update({titleLines: stored.titleLines === 1 ? 2 : 1}),
	};
};

// A name shortened from its front to fit `room` characters: back to its last
// slash where that fits, so claude/reviewer reads …/reviewer rather than
// …aude/reviewer, and otherwise just its tail.
export const cutFromFront = (name: string, room: number): string => {
	const tail = name.slice(name.lastIndexOf('/'));
	if (name.includes('/') && tail.length + 1 <= room) return `…${tail}`;

	return `…${name.slice(name.length - room + 1)}`;
};

// Who has a ticket, in the few characters a dense card has for it. Cut from
// the front when long, since what tells agents apart is the end of the name:
// claude/builder and claude/reviewer share their start. More than one is the
// first and a count; the tooltip names them all where anything is left out.
export const assigneeText = (
	assignees: readonly {name: string}[],
): {text: string; full: string; cut: boolean} => {
	const full = assignees.map(assignee => assignee.name).join(', ');
	const first = assignees[0]?.name;
	if (!first) return {text: '', full, cut: false};

	const more = assignees.length > 1 ? ` +${assignees.length - 1}` : '';
	const room = DENSE_ASSIGNEE_CHARS - more.length;
	const name = first.length > room ? cutFromFront(first, room) : first;

	return {text: name + more, full, cut: name !== first || more !== ''};
};
