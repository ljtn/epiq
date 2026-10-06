import React, {createContext, useContext} from 'react';
import {usePersistedFlag} from './use-persisted-flag';

// Whether a diff wraps its long lines rather than scrolling them sideways. Every
// diff reads it, so it is held once here rather than handed down to each.
type DiffWrap = readonly [boolean, (next: boolean) => void];

const DiffWrapContext = createContext<DiffWrap>([false, () => {}]);

// Mounted above the app, so it re-renders only when the flag changes.
export const DiffWrapProvider = ({children}: {children: React.ReactNode}) => (
	<DiffWrapContext.Provider value={usePersistedFlag('epiq.diff.wrap', false)}>
		{children}
	</DiffWrapContext.Provider>
);

export const useDiffWrap = (): DiffWrap => useContext(DiffWrapContext);
