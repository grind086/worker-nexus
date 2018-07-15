import {
    MessageInputType,
    MessageOutputType,
    NexusClientProvider,
    NexusConfig,
    NexusMessages,
    PortInfo,
    ProcedureMessages
} from './interfaces';
import { NexusClient } from './NexusClient';
import { NexusWorkerPool } from './NexusWorkerPool';

export class Nexus<T extends NexusMessages> implements NexusClientProvider<T> {
    public get config() {
        return this._config;
    }

    private _config: NexusConfig<T>;
    private _workerPools: Map<keyof T, NexusWorkerPool<T[keyof T]>>;
    private _portToPool: Map<PortInfo['id'], NexusWorkerPool<T[keyof T]>>;

    constructor(config: NexusConfig<T>) {
        this._config = config;
        this._workerPools = new Map();
        this._portToPool = new Map();

        for (const name of Object.keys(config)) {
            this._workerPools.set(name, new NexusWorkerPool(this, config[<keyof T>name]));
        }
    }

    /**
     * Runs a procedure on the next available client of the given type.
     * @param workerName The worker name
     * @param procedureName The procedure name
     * @param data The input data for the procedure
     * @param transfer An array of items to transfer
     */
    public run<U extends keyof T, V extends keyof ProcedureMessages<T[U]>>(
        workerName: U,
        procedurename: V,
        data: MessageInputType<T[U][V]>,
        transfer?: any[]
    ): Promise<MessageOutputType<T[U][V]>> {
        return this.requestClient(workerName).then(client =>
            client.run(procedurename, data, transfer).then(
                result => {
                    client.release();
                    return result;
                },
                error => {
                    client.release();
                    return Promise.reject(error);
                }
            )
        );
    }

    /**
     * Gets an instance of the given worker type
     * @param name The worker type
     */
    public requestClient<K extends keyof T>(name: K): Promise<NexusClient<T[K]>> {
        let once = false;

        return this.requestPort(name).then(
            port =>
                new NexusClient<T[K]>(port.port, () => {
                    if (!once) {
                        once = true;
                        this.releasePort(port);
                    }
                })
        );
    }

    /**
     * Gets a data port for a worker of the given type
     * @param name The worker type
     */
    public requestPort(name: keyof T) {
        const pool = this._workerPools.get(name);

        if (!pool) {
            return Promise.reject(`Invalid worker name "${name}"`);
        }

        return pool.requestPort().then(port => {
            this._portToPool.set(port.id, pool);
            return port;
        });
    }

    /**
     * Releases the given port
     */
    public releasePort(port: PortInfo) {
        const pool = this._portToPool.get(port.id);

        if (pool) {
            this._portToPool.delete(port.id);
            pool.releasePort(port);
        }
    }
}
