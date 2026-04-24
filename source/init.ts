export const isTesting = process.env['IS_EPIQ_TESTING'] === 'true';
export const getEpiqDirName = () => (isTesting ? '.epiq' : '.epiq');
