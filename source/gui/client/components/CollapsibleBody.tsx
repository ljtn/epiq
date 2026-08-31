import React, {useEffect, useRef, useState} from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';

// Room for a couple of paragraphs. Past it the body is clipped rather than
// given a scrollbar of its own: the aside already scrolls, and a second bar
// inside it is what this replaces.
export const COLLAPSED_BODY_HEIGHT = 320;

const FADE_HEIGHT = 64;

// Roughly the platform's own double-click interval, which is the window the
// second click of a pair can land in.
const DOUBLE_CLICK_MS = 500;

export const CollapsibleBody = ({
	children,
	fadeTo = GUI_THEME.panel2,
	onDoubleClick,
	testId,
}: {
	children: React.ReactNode;
	fadeTo?: string;
	onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
	testId?: string;
}) => {
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const content = contentRef.current;
		if (!content) return;

		// Measured, not guessed from the text's length: markdown reflows as
		// images load and as the aside is resized, and either can carry the
		// content across the clamp on its own.
		const measure = () =>
			setOverflows(content.scrollHeight > COLLAPSED_BODY_HEIGHT);

		measure();

		const observer = new ResizeObserver(measure);
		observer.observe(content);

		return () => observer.disconnect();
	}, [children]);

	const clamped = overflows && !expanded;

	const toggledAt = useRef(0);

	// Toggling moves the button out from under the pointer, so the second click
	// of a double-click on it lands on the body text that took its place — and
	// that click's target is what the browser reports for the pair. Nothing in
	// the event says the first click was the toggle; how recently the toggle
	// ran is the only thing that does.
	const handleDoubleClick: React.MouseEventHandler<HTMLDivElement> = event => {
		if (Date.now() - toggledAt.current < DOUBLE_CLICK_MS) return;

		onDoubleClick?.(event);
	};

	return (
		<div data-testid={testId}>
			{/* The double-click belongs to the content, so the toggle below is
			    outside this element. The fade is inside it, which is what puts
			    the gradient over the last lines of text rather than over the
			    toggle. */}
			<div
				onDoubleClick={handleDoubleClick}
				style={{
					position: 'relative',
					maxHeight: clamped ? COLLAPSED_BODY_HEIGHT : undefined,
					overflow: 'hidden',
				}}
			>
				<div ref={contentRef}>{children}</div>

				{clamped && (
					<div
						aria-hidden={true}
						style={{
							position: 'absolute',
							left: 0,
							right: 0,
							bottom: 0,
							height: FADE_HEIGHT,
							background: `linear-gradient(to bottom, ${GUI_THEME.transparent}, ${fadeTo})`,
							pointerEvents: 'none',
						}}
					/>
				)}
			</div>

			{overflows && (
				<div style={{display: 'flex', justifyContent: 'center'}}>
					<button
						type="button"
						data-testid="description-show-more"
						aria-expanded={expanded}
						onClick={() => {
							toggledAt.current = Date.now();
							setExpanded(!expanded);
						}}
						style={{
							position: 'relative',
							appearance: 'none',
							WebkitAppearance: 'none',
							background: 'transparent',
							border: 'none',
							color: GUI_THEME.dim2,
							cursor: 'pointer',
							fontFamily: 'inherit',
							fontSize: TEXT.ui,
							padding: '6px 8px 2px',
						}}
					>
						{expanded ? 'show less' : 'show more'}
					</button>
				</div>
			)}
		</div>
	);
};
