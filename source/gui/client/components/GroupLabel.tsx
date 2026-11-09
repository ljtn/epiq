import React, {useRef} from 'react';
import {
	GROUP_LABEL_COLOR,
	GROUP_LABEL_OPACITY,
	GROUP_LABEL_STYLE,
} from '../lib/group-label.style';
import {useGlowGradient} from './Panel';

// The small capitals naming a group, lit by the glow of whatever holds it.
export const GroupLabel = ({
	label,
	style,
}: {
	label: string;
	style?: React.CSSProperties;
}) => {
	const ref = useRef<HTMLSpanElement>(null);
	const {glow, gradient} = useGlowGradient(ref);

	return (
		<span
			ref={ref}
			aria-hidden
			style={{...GROUP_LABEL_STYLE, position: 'relative', ...style}}
		>
			{/* Two copies, so the faint one's opacity doesn't cap the lit one. */}
			<span style={{color: GROUP_LABEL_COLOR, opacity: GROUP_LABEL_OPACITY}}>
				{label}
			</span>
			<span
				style={{
					position: 'absolute',
					inset: 0,
					color: 'transparent',
					backgroundImage: gradient,
					WebkitBackgroundClip: 'text',
					backgroundClip: 'text',
					opacity: glow.strength,
					transition: 'opacity 140ms ease',
				}}
			>
				{label}
			</span>
		</span>
	);
};
