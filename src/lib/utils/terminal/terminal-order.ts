export function moveItem<T>(
	list: T[],
	fromIndex: number,
	insertIndex: number,
): T[] {
	if (fromIndex < 0 || fromIndex >= list.length) return list;
	if (insertIndex === fromIndex || insertIndex === fromIndex + 1) return list;
	const next = [...list];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(
		insertIndex > fromIndex ? insertIndex - 1 : insertIndex,
		0,
		moved,
	);
	return next;
}

export function insertAt<T>(list: T[], item: T, insertIndex: number): T[] {
	const next = [...list];
	next.splice(Math.max(0, Math.min(insertIndex, next.length)), 0, item);
	return next;
}
