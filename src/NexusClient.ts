import {
    ClientDataMessage,
    DATA_MESSAGE,
    InputMessages,
    MessageInputType,
    MessageOutputType,
    ProcedureMessages,
    WorkerDataMessage,
    WorkerMessages
} from './interfaces';
import { RequestManager } from './RequestManager';

/**
 * A client interface for one of the Nexus' workers.
 */
export class NexusClient<T extends WorkerMessages<T>> {
    private _port: MessagePort;
    private _release: () => void;
    private _wasReleased: boolean;
    private _requests: RequestManager;

    constructor(port: MessagePort, release: () => void) {
        this._port = port;
        this._release = release;
        this._wasReleased = false;
        this._requests = new RequestManager();

        this._clear(`Pending requests cleared`);

        port.onmessage = event => this._handleMessage(event.data);
    }

    /**
     * Sends a simple message.
     */
    public send<K extends keyof InputMessages<T>>(name: K, data: MessageInputType<T[K]>, transfer?: any[]) {
        this._postMessage({ data, name: <string>name, type: DATA_MESSAGE.INPUT }, transfer);
    }

    /**
     * Runs a procedure.
     */
    public run<K extends keyof ProcedureMessages<T>>(
        name: K,
        data: MessageInputType<T[K]>,
        transfer?: any[]
    ): Promise<MessageOutputType<T[K]>> {
        const { reqid, promise } = this._requests.create();

        try {
            this._postMessage({ reqid, data, name: <string>name, type: DATA_MESSAGE.INPUT }, transfer);
        } catch (err) {
            this._requests.reject(reqid, err);
        }

        return promise;
    }

    /**
     * Release the client, allowing its worker to return to the pool. The client will be unusable after calling this method.
     */
    public release() {
        if (this._wasReleased) {
            throw new Error(`NexusClient#release was already called`);
        }

        this._clear(`Client released`);

        this._wasReleased = true;
        this._port.onmessage = null!;

        this._release();

        this._port = null!;
        this._release = null!;
        this._requests = null!;
    }

    /**
     * Clear all pending requests on this data port
     */
    private _clear(reason: string) {
        this._requests.rejectAll(reason);
        this._postMessage({ type: DATA_MESSAGE.CLEAR });
    }

    /**
     * Post a message to the data port
     */
    private _postMessage(message: WorkerDataMessage, transfer?: any[]) {
        if (this._wasReleased) {
            throw new Error(`Client was already released`);
        }

        this._port.postMessage(message, transfer);
    }

    /**
     * Handle a message from the data port
     */
    private _handleMessage(message: ClientDataMessage) {
        if (message.type !== DATA_MESSAGE.OUTPUT) {
            throw new Error(`Client received unexpected message of type ${message.type}`);
        }

        this._requests.resolve(message.reqid, message.data);
    }
}
