import { Deferred } from './Deferred';
import { RequestId } from './interfaces';

// let nextManagerId = 0;

export class RequestManager {
    // private _managerId: number;
    private _nextRequestId: number;
    private _pendingRequests: Map<RequestId, Deferred>;

    constructor() {
        // this._managerId = nextManagerId++;
        this._nextRequestId = 0;
        this._pendingRequests = new Map();
    }

    public has(reqid: RequestId) {
        return this._pendingRequests.has(reqid);
    }

    public create<T = any>() {
        const reqid = this._getRequestId();
        const deferred = new Deferred<T>();

        this._pendingRequests.set(reqid, deferred);

        return { reqid, promise: deferred.promise };
    }

    public resolve(reqid: RequestId, result: any) {
        const deferred = this._pendingRequests.get(reqid);

        if (deferred) {
            deferred.resolve(result);
            this._pendingRequests.delete(reqid);
        }
    }

    public reject(reqid: RequestId, reason: string) {
        const deferred = this._pendingRequests.get(reqid);

        if (deferred) {
            deferred.reject(reason);
            this._pendingRequests.delete(reqid);
        }
    }

    public rejectAll(reason: string) {
        this._pendingRequests.forEach(deferred => deferred.reject(reason));
        this._pendingRequests.clear();
    }

    private _getRequestId(): RequestId {
        return this._nextRequestId++;
    }
}
