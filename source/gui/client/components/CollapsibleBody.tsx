import React, {useEffect, useRef, useState} from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';

// Past this the body is clipped, not scrolled: the aside already scrolls.
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

		// Measured, since markdown reflows as images load and the aside resizes.
		const measure = () =>
			setOverflows(content.scrollHeight > COLLAPSED_BODY_HEIGHT);

		measure();

		const observer = new ResizeObserver(measure);
		observer.observe(content);

		return () => observer.disconnect();
	}, [children]);

	const clamped = overflows && !expanded;

	const toggledAt = useRef(0);

	// Toggling moves the button, so a double-click's second click lands on the text.
	// Only the toggle's recency tells the two apart.
	const handleDoubleClick: React.MouseEventHandler<HTMLDivElement> = event => {
		if (Date.now() - toggledAt.current < DOUBLE_CLICK_MS) return;

		onDoubleClick?.(event);
	};

	return (
		<div data-testid={testId}>
			{/* The double-click belongs to the content, so the toggle sits outside it. */}
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
						{expanded ? 'Show less' : 'Show more'}
					</button>
				</div>
			)}
		</div>
	);
};
