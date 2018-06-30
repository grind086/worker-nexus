import { PortInfo } from "./interfaces";

export class WorkerInfo {
    public get totalPortCount() {
        return this.ports.length + this.pendingPorts;
    }

    public get availablePortCount() {
        return this.availablePorts.length;
    }

    public get usedPortCount() {
        return this.totalPortCount - this.availablePortCount;
    }

    public ports: PortInfo['id'][] = [];
    public availablePorts: PortInfo[] = [];
    public pendingPorts = 0;

    constructor(public worker: Worker) {}

    public owns(info: PortInfo) {
        return this.ports.includes(info.id);
    }

    public isAvailable(info: PortInfo) {
        return this.availablePorts.some(port => port.id === info.id);
    }
}
