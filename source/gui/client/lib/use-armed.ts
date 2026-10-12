import {useState} from 'react';

// Two clicks for a thing that cannot be taken back: the first arms one
// control, the second commits it. Armed by id rather than a flag, so moving
// to another row arms that one and disarms the first.
export const useArmed = <T>() => {
	const [armed, setArmed] = useState<T | null>(null);

	// True on the second press of the same control: the commit.
	const press = (id: T): boolean => {
		if (armed === id) {
			setArmed(null);
			return true;
		}

		setArmed(id);
		return false;
	};

	const disarm = () => setArmed(null);

	return {armed, press, disarm};
};
