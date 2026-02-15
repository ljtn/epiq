import {Text} from 'ink';
import React from 'react';

// const onChange = (_value: string) => {
// 	// No-op for now
// };
// const onSubmit = (_value: string) => {
// 	// No-op for now
// };
export const TextInput: React.FC<{
	value: string;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
}> = ({value}) => <Text>{value}</Text>;
