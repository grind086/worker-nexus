import { NexusClientProvider, NexusMessages, PortInfo } from './interfaces';
import { NexusClient } from './NexusClient';
import { NexusWorkerPool } from './NexusWorkerPool';

type NexusConfig<T extends NexusMessages<T>> = {
    [K in keyof T]: {
        ctor: () => Worker;
        maxWorkers: number;
        maxPorts: number;
    }
};

export class Nexus<T extends NexusMessages<T>> implements NexusClientProvider<T> {
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

    public releasePort(port: PortInfo) {
        const pool = this._portToPool.get(port.id);

        if (pool) {
            this._portToPool.delete(port.id);
            pool.releasePort(port);
        }
    }
}
