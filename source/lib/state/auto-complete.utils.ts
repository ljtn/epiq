import {CmdKeywords} from '../command-line/command-line-sequence-intent.js';
import {findOverlap} from '../utils/string.utils.js';

const COMMON_WORDS = [
	// Add custom project terms here
	// ...
	// ... or use a llm for dynamic suggestions based on project context

	// common ticket domains
	'frontend',
	'backend',
	'infrastructure',
	'architecture',
	'integration',
	'configuration',
	'implementation',

	// issue / quality language
	'exception',
	'incident',
	'defect',
	'regression',
	'degradation',
	'malfunction',
	'instability',
	'intermittent',
	'reproducibility',
	'reproduction',
	'investigation',
	'triage',
	'workaround',
	'mitigation',
	'remediation',
	'optimization',
	'stabilization',
	'refinement',

	// correctness / safety / compliance
	'validation',
	'verification',
	'authorization',
	'authentication',
	'confidentiality',
	'availability',
	'accessibility',
	'reliability',
	'compliance',
	'governance',

	// systems / platform concepts
	'dependency',
	'orchestration',
	'provisioning',
	'synchronization',
	'compatibility',
	'incompatibility',
	'interoperability',
	'observability',
	'instrumentation',
	'telemetry',

	// data / processing concepts
	'serialization',
	'deserialization',
	'initialization',
	'instantiation',
	'propagation',
	'aggregation',
	'consolidation',
	'normalization',
	'standardization',
	'transformation',
	'reconciliation',
	'correlation',

	// runtime / scaling / failure modes
	'concurrency',
	'parallelism',
	'contention',
	'deadlock',
	'throttling',
	'ratelimiting',
	'backpressure',
	'fragmentation',
	'saturation',
	'exhaustion',
	'partitioning',
	'replication',
	'redundancy',
	'failover',
	'deprecation',
	'obsolescence',

	// maintainability
	'refactoring',
	'modularization',
	'encapsulation',
	'abstraction',
	'extensibility',
	'configurability',
	'maintainability',
	'recoverability',
	'sustainability',

	// general ticket phrasing but still useful
	'performance',
	'functionality',
	'requirement',
	'recommendation',
];

export const getCommandHint = (command: string) => {
	const space = ' ';
	return getHint(Object.values(CmdKeywords), command, 1) + space;
};
export const getWordHint = (command: string) => {
	const space = ' ';
	return getHint([...COMMON_WORDS], command, 3) + space;
};

const getHint = (wordList: string[], command: string, overlapThreshold = 1) => {
	if (!command) return '';

	const words = command.split(' ');
	const lastWord = words.at(-1) || '';
	if (!lastWord) return '';

	const hint = wordList.find(
		term =>
			term.startsWith(lastWord) &&
			findOverlap(lastWord, term) >= overlapThreshold,
	);

	return hint || '';
};
