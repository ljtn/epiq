export function moveItemInArray<T>({
	array,
	from,
	to,
}: {
	array: T[];
	from: number;
	to: number;
}) {
	if (from < 0 || from >= array.length || to < 0 || to >= array.length) return;
	const [item] = array.splice(from, 1);
	if (item) array.splice(to, 0, item);
}
