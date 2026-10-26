import {Text} from 'ink';
import React from 'react';

export const TextInput: React.FC<{
	value: string;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
}> = ({value}) => <Text>{value}</Text>;
