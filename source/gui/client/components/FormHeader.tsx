import React from 'react';

export const FormHeader = ({children}: {children: React.ReactNode}) => (
	<div
		style={{
			display: 'flex',
			justifyContent: 'space-between',
			alignItems: 'center',
			gap: 12,
			marginBottom: 18,
		}}
	>
		{children}
	</div>
);
