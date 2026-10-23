import React, {useState} from 'react';

// Keyboard focus drawn as the pointer is: whatever lifts a control under the
// pointer lifts it under the keyboard too, in place of the browser's ring. A
// click focuses a button as well but is not `:focus-visible`, so it adds
// nothing a click had not.
export const useFocusLift = <T extends HTMLElement>(handlers: {
	onFocus?: React.FocusEventHandler<T>;
	onBlur?: React.FocusEventHandler<T>;
}) => {
	const [focused, setFocused] = useState(false);

	return {
		focused,
		focusProps: {
			onFocus: (event: React.FocusEvent<T>) => {
				setFocused(event.currentTarget.matches(':focus-visible'));
				handlers.onFocus?.(event);
			},
			onBlur: (event: React.FocusEvent<T>) => {
				setFocused(false);
				handlers.onBlur?.(event);
			},
		},
	};
};
