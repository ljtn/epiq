export const cmdValidity = {
	None: 'none',
	Invalid: 'invalid',
	Valid: 'valid',
} as const;

export type CmdValidity = (typeof cmdValidity)[keyof typeof cmdValidity];
