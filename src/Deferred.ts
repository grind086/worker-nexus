export class Deferred<T = any> {
    public promise: Promise<T>;

    public get resolve() {
        return this._resolve;
    }

    public get reject() {
        return this._reject;
    }

    private _resolve!: (result: T | PromiseLike<T>) => void;
    private _reject!: (error: Error | string) => void;

    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }
}
