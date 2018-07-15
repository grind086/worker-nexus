import {
    ClientDataMessage,
    DATA_MESSAGE,
    InputMessages,
    INTERNAL_MESSAGE,
    MessageInputType,
    MessageOutputType,
    NexusClientProvider,
    NexusInternalMessage,
    NexusMessages,
    PortInfo,
    ProcedureMessages,
    WorkerDataMessage,
    WorkerInternalMessage,
    WorkerLike,
    WorkerMessages
} from './interfaces';
import { NexusClient } from './NexusClient';
import { RequestManager } from './RequestManager';

/**
 * The Nexus worker context. Should be instantiated in a worker by passing the native worker object.
 * @param nativeWorker The native Worker object (usually `self` in the global context)
 */
export class NexusWorker<T extends NexusMessages, K extends keyof T, M extends WorkerMessages = T[K]>
    implements NexusClientProvider<T> {
    /** Set to true to allow only a single data port to be created */
    public exclusive: boolean;

    private _nativeWorker: WorkerLike;
    private _dataPorts: Map<string, MessagePort>; // <Remote, Local>
    private _dataSessions: Map<MessagePort, number>; // <Local, sessionId>

    private _requests: RequestManager;
    private _sendHandlers: Map<string, (data: MessageInputType<M[keyof M]>) => void>;
    private _runHandlers: Map<
        string,
        (
            data: MessageInputType<M[keyof M]>,
            reply: (result: MessageOutputType<M[keyof M]>, transfer?: any[]) => void
        ) => void
    >;

    constructor(nativeWorker: WorkerLike) {
        this.exclusive = false;

        this._nativeWorker = nativeWorker;
        this._dataPorts = new Map();
        this._dataSessions = new Map();

        this._requests = new RequestManager();
        this._sendHandlers = new Map();
        this._runHandlers = new Map();

        nativeWorker.onmessage = event => this._handleInternalMessage(event.data);
    }

    /**
     * Handle an input message
     */
    public onSend<N extends keyof InputMessages<M>>(name: N, handler: (data: MessageInputType<M[N]>) => void): void {
        if (this._sendHandlers.has(<string>name)) {
            throw new Error(`An input handler for messages of type "${name}" is already registered`);
        }

        this._sendHandlers.set(<string>name, handler);
    }

    /**
     * Handle a procedure message
     */
    public onRun<N extends keyof ProcedureMessages<M>>(
        name: N,
        handler: (
            data: MessageInputType<M[N]>,
            reply: (result: MessageOutputType<M[N]>, transfer?: any[]) => void
        ) => void
    ): void {
        if (this._runHandlers.has(<string>name)) {
            throw new Error(`A procedure handler for messages of type "${name}" is already registered`);
        }

        this._runHandlers.set(<string>name, handler);
    }

    /**
     * Request a `NexusClient` for a worker with the given name.
     */
    public requestClient<N extends keyof T>(name: N): Promise<NexusClient<T[N]>> {
        const { reqid, promise } = this._requests.create();

        try {
            this._postInternalMessage({ reqid, name: <string>name, type: INTERNAL_MESSAGE.DATA_PORT_REQUEST });
        } catch (err) {
            this._requests.reject(reqid, err);
        }

        return promise;
    }

    private _receiveWorker(reqid: number, port: PortInfo) {
        if (!this._requests.has(reqid)) {
            throw new Error(`Received a port for an invalid worker request`);
        }

        this._requests.resolve(
            reqid,
            new NexusClient(port.port, () =>
                this._postInternalMessage({ port, type: INTERNAL_MESSAGE.DATA_PORT_RELEASE }, [port.port])
            )
        );
    }

    private _createDataPort(): PortInfo {
        const { port1: localPort, port2: remotePort } = new MessageChannel();
        const id = Math.random()
            .toString(16)
            .slice(2);

        this._dataPorts.set(id, localPort);
        this._dataSessions.set(localPort, 0);

        localPort.onmessage = event => this._handleDataMessage(localPort, event.data);

        return { id, port: remotePort };
    }

    private _releaseDataPort(port: PortInfo) {
        const localPort = this._dataPorts.get(port.id);

        if (localPort) {
            localPort.onmessage = null;
            this._dataPorts.delete(port.id);
            this._dataSessions.delete(port.port);
        }
    }

    private _postDataMessage(port: MessagePort, session: number, message: ClientDataMessage, transfer?: any[]) {
        if (session !== this._dataSessions.get(port)) {
            return;
        }

        port.postMessage(message, transfer);
    }

    private _handleDataMessage(port: MessagePort, message: WorkerDataMessage) {
        switch (message.type) {
            case DATA_MESSAGE.INPUT:
                if (message.reqid !== undefined) {
                    const handler = this._runHandlers.get(message.name);
                    const session = this._dataSessions.get(port)!;

                    if (!handler) {
                        throw new Error(`Missing handler for procedure message of type "${message.name}"`);
                    }

                    handler(message.data, (result, transfer) =>
                        this._postDataMessage(
                            port,
                            session,
                            { reqid: message.reqid!, type: DATA_MESSAGE.OUTPUT, data: result },
                            transfer
                        )
                    );
                } else {
                    const handler = this._sendHandlers.get(message.name);

                    if (!handler) {
                        throw new Error(`Missing handler for input message of type "${message.name}"`);
                    }

                    handler(message.data);
                }
                break;
            case DATA_MESSAGE.CLEAR:
                this._dataSessions.set(port, this._dataSessions.get(port)! + 1);
                break;
        }
    }

    private _postInternalMessage(message: NexusInternalMessage, transfer?: any[]) {
        this._nativeWorker.postMessage(message, transfer);
    }

    private _handleInternalMessage(message: WorkerInternalMessage) {
        switch (message.type) {
            case INTERNAL_MESSAGE.DATA_PORT_REQUEST:
                if (this.exclusive && this._dataPorts.size > 0) {
                    this._postInternalMessage({
                        reqid: message.reqid,
                        type: INTERNAL_MESSAGE.ERROR,
                        error: `Cannot request multiple ports from an exclusive worker`
                    });
                } else {
                    const port = this._createDataPort();

                    this._postInternalMessage(
                        {
                            port,
                            reqid: message.reqid,
                            type: INTERNAL_MESSAGE.DATA_PORT_RESPONSE
                        },
                        [port.port]
                    );
                }
                break;
            case INTERNAL_MESSAGE.ERROR:
                this._requests.reject(message.reqid, message.error);
                break;
            case INTERNAL_MESSAGE.DATA_PORT_RESPONSE:
                this._receiveWorker(message.reqid, message.port);
                break;
            case INTERNAL_MESSAGE.DATA_PORT_RELEASE:
                this._releaseDataPort(message.port);
                break;
        }
    }
}
