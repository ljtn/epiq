// The binary input shape for ops that take whole files: a list of named byte
// strings, so a log's bytes cross the boundary as they are rather than as a
// JSON string escaped byte by byte.
//
// `[u32 count] ( [u32 name length][name] [u32 data length][data] )*`, little
// endian, mirroring `frame.rs`.

export type NamedBytes = {name: string; data: Uint8Array};

const encoder = new TextEncoder();

export const encodeFrame = (items: readonly NamedBytes[]): Uint8Array => {
	const names = items.map(item => encoder.encode(item.name));
	const total = items.reduce(
		(sum, item, index) => sum + 8 + names[index]!.length + item.data.length,
		4,
	);

	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);
	let offset = 0;

	const u32 = (value: number) => {
		view.setUint32(offset, value, true);
		offset += 4;
	};

	u32(items.length);

	for (const [index, item] of items.entries()) {
		const name = names[index]!;
		u32(name.length);
		out.set(name, offset);
		offset += name.length;
		u32(item.data.length);
		out.set(item.data, offset);
		offset += item.data.length;
	}

	return out;
};
