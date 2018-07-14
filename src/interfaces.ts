import { NexusClient } from './NexusClient';

//
// Util
//

export type PickKeys<T, U> = { [K in keyof T]: T[K] extends U ? K : never }[keyof T];
export type OmitKeys<T, U> = { [K in keyof T]: T[K] extends U ? never : K }[keyof T];
export type PickProperties<T, U> = { [K in PickKeys<T, U>]: T[K] };
export type OmitProperties<T, U> = { [K in OmitKeys<T, U>]: T[K] };

//
// Messages
//

export interface InputMessage {
    input: any;
}

export interface OutputMessage {
    output: any;
}

export interface ProcedureMessage {
    input: any;
    output: any;
}

export type Message = InputMessage | OutputMessage | ProcedureMessage;

export type MessageInputType<T extends Message> = T extends InputMessage ? T['input'] : never;
export type MessageOutputType<T extends Message> = T extends OutputMessage ? T['output'] : never;

export type WorkerMessages<T extends WorkerMessages<T>> = { [K in keyof T]: Message };

export type ProcedureMessages<T extends WorkerMessages<T>> = PickProperties<T, ProcedureMessage>;
export type InputMessages<T extends WorkerMessages<T>> = PickProperties<
    OmitProperties<T, ProcedureMessage>,
    InputMessage
>;
export type OutputMessages<T extends WorkerMessages<T>> = PickProperties<
    OmitProperties<T, ProcedureMessage>,
    OutputMessage
>;

export type NexusMessages<T extends NexusMessages<T>> = { [K in keyof T]: WorkerMessages<T[K]> };

//
// (Internal) Aliases
//

export type RequestId = number;

//
// (Internal) Data Messages
//

export const enum DATA_MESSAGE {
    CLEAR,
    INPUT,
    OUTPUT
}

export interface ClearPendingDataMessage {
    type: DATA_MESSAGE.CLEAR;
}

export interface InputDataMessage {
    reqid?: RequestId;
    type: DATA_MESSAGE.INPUT;
    name: string;
    data: any;
}

export interface OutputDataMessage {
    reqid: RequestId;
    type: DATA_MESSAGE.OUTPUT;
    data: any;
}

export type ClientDataMessage = OutputDataMessage;
export type WorkerDataMessage = ClearPendingDataMessage | InputDataMessage;

//
// (Internal) Nexus Messages
//

export const enum INTERNAL_MESSAGE {
    ERROR,
    DATA_PORT_REQUEST,
    DATA_PORT_RESPONSE,
    DATA_PORT_RELEASE
}

export interface PortInfo {
    id: string;
    port: MessagePort;
}

export interface ErrorInternalMessage {
    reqid: RequestId;
    type: INTERNAL_MESSAGE.ERROR;
    error: string;
}

export interface PortRequestInternalMessage {
    reqid: RequestId;
    type: INTERNAL_MESSAGE.DATA_PORT_REQUEST;
}

export interface NamedPortRequestInternalMessage {
    reqid: RequestId;
    type: INTERNAL_MESSAGE.DATA_PORT_REQUEST;
    name: string;
}

export interface PortResponseInternalMessage {
    reqid: RequestId;
    type: INTERNAL_MESSAGE.DATA_PORT_RESPONSE;
    port: PortInfo;
}

export interface PortReleaseInternalMessage {
    type: INTERNAL_MESSAGE.DATA_PORT_RELEASE;
    port: PortInfo;
}

export type NexusInternalMessage =
    | ErrorInternalMessage
    | NamedPortRequestInternalMessage
    | PortResponseInternalMessage
    | PortReleaseInternalMessage;

export type WorkerInternalMessage =
    | ErrorInternalMessage
    | PortRequestInternalMessage
    | PortResponseInternalMessage
    | PortReleaseInternalMessage;

//
//
//

export type NexusConfig<T extends NexusMessages<T>> = { [K in keyof T]: PoolConfig };

export interface PoolConfig {
    ctor: () => WorkerLike;
    maxPorts: number;
    maxWorkers: number;
}

export interface WorkerLike {
    onmessage: ((ev: MessageEvent) => any) | null;
    postMessage(message: any, transfer?: any[]): void;
}

export interface NexusClientProvider<T extends NexusMessages<T>> {
    requestClient<K extends keyof T>(name: K): Promise<NexusClient<T[K]>>;
}
