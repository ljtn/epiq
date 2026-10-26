import {EventCatalog} from './event-catalog.js';
import {createLoader} from './event-load.js';
import {createMaterializer} from './event-materialize.js';
import {createPersister} from './event-persist.js';
import {createWriter} from './event-write.js';
import {EventMap} from './event.model.js';

/** One log for one catalog, with its edge, replay batch and id clock held per instance. */
export const createEventLog = <M extends EventMap>(
	catalog: EventCatalog<M>,
) => {
	const materializer = createMaterializer(catalog);
	const loader = createLoader(catalog);
	const persister = createPersister(loader);
	const writer = createWriter(catalog, materializer, persister);

	return {...materializer, ...loader, ...persister, ...writer};
};

export type EventLog<M extends EventMap> = ReturnType<typeof createEventLog<M>>;
