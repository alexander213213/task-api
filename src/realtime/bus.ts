import { EventEmitter } from "events";

export type TaskEventType =
    | "task:created"
    | "proposal:created"
    | "task:assigned"
    | "task:unassigned"
    | "task:submitted"
    | "task:confirmed"
    | "review:received";

export interface TaskEvent<T = unknown> {
    /** Monotonic server sequence; clients resume with Last-Event-ID. */
    id: number;
    type: TaskEventType;
    /** User ids allowed to receive this event; "*" broadcasts to all authed clients. */
    to: string[];
    data: T;
    at: string;
}

const BUFFER_CAP = 200;

class EventBus {
    private emitter = new EventEmitter();
    private buffer: TaskEvent[] = [];
    private seq = 0;

    constructor() {
        this.emitter.setMaxListeners(1000);
    }

    publish<T>(type: TaskEventType, to: string[], data: T): TaskEvent<T> {
        const event: TaskEvent<T> = {
            id: ++this.seq,
            type,
            to,
            data,
            at: new Date().toISOString(),
        };
        this.buffer.push(event);
        if (this.buffer.length > BUFFER_CAP) this.buffer.shift();
        this.emitter.emit("event", event);
        return event;
    }

    subscribe(listener: (event: TaskEvent) => void): () => void {
        this.emitter.on("event", listener);
        return () => this.emitter.off("event", listener);
    }

    /** Events after the given id, for Last-Event-ID resume. */
    since(id: number): TaskEvent[] {
        return this.buffer.filter((e) => e.id > id);
    }

    /** Test isolation only — never call in request handling. */
    reset(): void {
        this.buffer = [];
        this.seq = 0;
        this.emitter.removeAllListeners();
    }
}

export const bus = new EventBus();
