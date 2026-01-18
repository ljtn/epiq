import {Mode} from '../../model/action-map.model.js';
import {patchState} from '../../state/state.js';

export const onConfirmCommandLineInput = (input: string) => {
	switch (input.trim()) {
		case 'help':
		case 'h':
			patchState({
				mode: Mode.HELP,
				commandLineInput: '',
			});
			return;
		default:
			patchState({
				mode: Mode.DEFAULT,
				commandLineInput: '',
			});
			return;
	}
};
