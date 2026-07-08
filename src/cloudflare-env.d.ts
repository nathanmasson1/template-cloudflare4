declare module 'cloudflare:workers' {
  export const env: Record<string, any>;
  export class DurableObject<T = any> {
    constructor(state: any, env: T);
  }
}

type ExecutionContext = {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException?(): void;
};

type ScheduledController = {
  cron: string;
  scheduledTime: number;
  type: 'scheduled';
};
