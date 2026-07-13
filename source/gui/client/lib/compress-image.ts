/**
 * Client-side attachment compression. The browser's own codecs do the work,
 * keeping heavy image dependencies (sharp/libvips) out of the binary.
 *
 * Pipeline: decode → downscale to a sane long edge → re-encode as webp,
 * stepping quality down until the blob fits under the cap.
 */

const MAX_LONG_EDGE = 1600;
const MAX_BYTES = 500 * 1024;
const QUALITY_STEPS = [0.8, 0.7, 0.6, 0.5, 0.4];

export type CompressedImage = {
	blob: Blob;
	name: string;
};

const toBlob = (
	canvas: HTMLCanvasElement,
	type: string,
	quality: number,
): Promise<Blob | null> =>
	new Promise(resolve => canvas.toBlob(resolve, type, quality));

const replaceExtension = (name: string, ext: string): string => {
	const base = name.replace(/\.[a-z0-9]+$/i, '');
	return `${base || 'image'}.${ext}`;
};

export const compressImage = async (
	file: File,
): Promise<CompressedImage | {error: string}> => {
	// Re-encoding through canvas flattens animation; small gifs pass through.
	if (file.type === 'image/gif') {
		if (file.size <= MAX_BYTES) {
			return {blob: file, name: file.name};
		}

		return {
			error: `GIFs are attached as-is and this one exceeds ${Math.round(
				MAX_BYTES / 1024,
			)} KB`,
		};
	}

	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return {error: 'Not a supported image'};
	}

	const scale = Math.min(
		1,
		MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height),
	);

	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));

	const context = canvas.getContext('2d');
	if (!context) {
		bitmap.close();
		return {error: 'Unable to process image'};
	}

	context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();

	for (const quality of QUALITY_STEPS) {
		const blob = await toBlob(canvas, 'image/webp', quality);

		if (blob && blob.size <= MAX_BYTES) {
			return {blob, name: replaceExtension(file.name, 'webp')};
		}
	}

	return {
		error: `Unable to compress image under ${Math.round(MAX_BYTES / 1024)} KB`,
	};
};

export const blobToBase64 = (blob: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = () => {
			const dataUrl = String(reader.result ?? '');
			const base64 = dataUrl.split(',')[1];

			if (!base64) {
				reject(new Error('Unable to encode image'));
				return;
			}

			resolve(base64);
		};

		reader.onerror = () => reject(new Error('Unable to read image'));
		reader.readAsDataURL(blob);
	});
