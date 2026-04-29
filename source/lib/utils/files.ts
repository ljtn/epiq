import fs from 'node:fs';

export const fileContentEquals = (a: string, b: string): boolean => {
	if (!fs.existsSync(a) || !fs.existsSync(b)) return false;

	const aStat = fs.statSync(a);
	const bStat = fs.statSync(b);

	if (aStat.size !== bStat.size) return false;

	const aBuf = fs.readFileSync(a);
	const bBuf = fs.readFileSync(b);

	return aBuf.equals(bBuf);
};
