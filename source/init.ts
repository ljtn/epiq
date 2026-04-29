export const isLocal = process.env['IS_LOCAL'] === 'true';
export const getEpiqDirName = () => (isLocal ? '.epiq' : '.epiq');
