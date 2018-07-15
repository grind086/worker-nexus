import { Deferred } from './Deferred';
import {
    INTERNAL_MESSAGE,
    NexusInternalMessage,
    PoolConfig,
    PortInfo,
    WorkerInternalMessage,
    WorkerLike,
    WorkerMessages
} from './interfaces';
import { Nexus } from './Nexus';
import { NexusClient } from './NexusClient';
import { RequestManager } from './RequestManager';
import { WorkerInfo } from './WorkerInfo';

// tslint:disable-next-line:max-classes-per-file
export class NexusWorkerPool<T extends WorkerMessages> {
    public maxPorts: number;
    public maxWorkers: number;

    private _nexus: Nexus<any>;
    private _ctor: () => WorkerLike;
    private _requests: RequestManager;
    private _portQueue: Array<Deferred<PortInfo>>;
    private _workers: WorkerInfo[];

    constructor(nexus: Nexus<any>, { ctor, maxPorts, maxWorkers }: PoolConfig) {
        this._nexus = nexus;
        this._ctor = ctor;
        this._requests = new RequestManager();
        this._portQueue = [];
        this._workers = [];

        this.maxPorts = maxPorts;
        this.maxWorkers = maxWorkers;
    }

    public requestClient(): Promise<NexusClient<T>> {
        let once = false;

        return this.requestPort().then(
            port =>
                new NexusClient<T>(port.port, () => {
                    if (!once) {
                        once = true;
                        this.releasePort(port);
                    }
                })
        );
    }

    public requestPort(): Promise<PortInfo> {
        const workerInfo = this._getLeastUsedWorker();

        if (workerInfo) {
            if (workerInfo.availablePortCount) {
                return Promise.resolve(workerInfo.availablePorts.pop()!);
            }

            if (workerInfo.totalPortCount < this.maxPorts) {
                return this._instantiatePort(workerInfo);
            }
        }

        const deferred = new Deferred();

        this._portQueue.push(deferred);
        return deferred.promise;
    }

    public releasePort(info: PortInfo) {
        if (this._portQueue.length) {
            return this._portQueue.shift()!.resolve(info);
        }

        const worker = this._getWorkerForPort(info);

        if (worker && worker.owns(info) && !worker.isAvailable(info)) {
            worker.availablePorts.push(info);
        }
    }

    private _getWorkerForPort(info: PortInfo) {
        for (const workerInfo of this._workers) {
            if (workerInfo.owns(info)) {
                return workerInfo;
            }
        }

        return null;
    }

    private _getLeastUsedWorker() {
        let leastUsed: number = Infinity;
        let leastUsedWorker: WorkerInfo | null = null;

        for (const workerInfo of this._workers) {
            const workerUsed = workerInfo.usedPortCount;

            // If we have a fully idle worker return it immediately
            if (workerUsed === 0) {
                return workerInfo;
            }

            if (workerUsed < leastUsed) {
                leastUsed = workerUsed;
                leastUsedWorker = workerInfo;
            }
        }

        // If there are no fully idle workers, see if we can make a new one
        if (this._workers.length < this.maxWorkers) {
            return this._instantiateWorker();
        }

        // Otherwise return the worker with the least ports currently lent out
        return leastUsedWorker;
    }

    private _postInternalMessage(worker: WorkerLike, message: WorkerInternalMessage, transfer?: any[]) {
        worker.postMessage(message, transfer);
    }

    private _handleInternalMessage(worker: WorkerLike, message: NexusInternalMessage) {
        switch (message.type) {
            case INTERNAL_MESSAGE.DATA_PORT_REQUEST:
                this._nexus.requestPort(message.name).then(
                    port =>
                        this._postInternalMessage(
                            worker,
                            {
                                port,
                                reqid: message.reqid,
                                type: INTERNAL_MESSAGE.DATA_PORT_RESPONSE
                            },
                            [port.port]
                        ),
                    error =>
                        this._postInternalMessage(worker, {
                            error,
                            reqid: message.reqid,
                            type: INTERNAL_MESSAGE.ERROR
                        })
                );
                break;
            case INTERNAL_MESSAGE.DATA_PORT_RELEASE:
                this._nexus.releasePort(message.port);
                break;
            case INTERNAL_MESSAGE.ERROR:
                this._requests.reject(message.reqid, message.error);
                break;
            case INTERNAL_MESSAGE.DATA_PORT_RESPONSE:
                this._requests.resolve(message.reqid, message.port);
                break;
        }
    }

    private _instantiateWorker() {
        if (this._workers.length >= this.maxWorkers) {
            throw new Error(`Worker already has the maximum number of instances (${this.maxWorkers})`);
        }

        const worker = this._ctor();
        const workerInfo = new WorkerInfo(worker);

        worker.onmessage = event => this._handleInternalMessage(worker, event.data);
        this._workers.push(workerInfo);

        return workerInfo;
    }

    private _instantiatePort(workerInfo: WorkerInfo): Promise<PortInfo> {
        if (workerInfo.totalPortCount >= this.maxPorts) {
            return Promise.reject(
                new Error(`The maximum number of ports have already been created for the given worker`)
            );
        }

        workerInfo.pendingPorts += 1;

        const { reqid, promise } = this._requests.create<PortInfo>();

        try {
            this._postInternalMessage(workerInfo.worker, {
                reqid,
                type: INTERNAL_MESSAGE.DATA_PORT_REQUEST
            });
        } catch (err) {
            this._requests.reject(reqid, err);
        }

        return promise.then(
            port => {
                workerInfo.pendingPorts -= 1;
                workerInfo.ports.push(port.id);
                return port;
            },
            error => {
                workerInfo.pendingPorts -= 1;
                return Promise.reject(error);
            }
        );
    }
}
