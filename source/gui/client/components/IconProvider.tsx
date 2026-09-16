// The marks an agent's name is drawn with in place of its provider prefix —
// see lib/agent-identity. Small glyphs in the current colour, so they take
// the actor's own tint like the name beside them: an eight-rayed spark for
// Claude, a six-sided knot for Codex. Recognisable at ten pixels, which is
// where they are used.

import {AgentProvider} from '../lib/agent-identity';

const IconClaude = ({size}: {size: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="3"
		strokeLinecap="round"
		aria-hidden="true"
	>
		<line x1="12" y1="3" x2="12" y2="21" />
		<line x1="3" y1="12" x2="21" y2="12" />
		<line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
		<line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
	</svg>
);

const IconCodex = ({size}: {size: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2.5"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<polygon points="12 2.5 20.2 7.25 20.2 16.75 12 21.5 3.8 16.75 3.8 7.25" />
		<polygon points="12 8 15.5 10 15.5 14 12 16 8.5 14 8.5 10" />
	</svg>
);

export const IconProvider = ({
	provider,
	size = 10,
}: {
	provider: AgentProvider;
	size?: number;
}) =>
	provider === 'claude' ? (
		<IconClaude size={size} />
	) : (
		<IconCodex size={size} />
	);
