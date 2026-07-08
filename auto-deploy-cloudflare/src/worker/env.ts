export interface Env {
  APP_DB: D1Database;
  APP_BUCKET: R2Bucket;
  ASSETS: { fetch(request: Request): Promise<Response> };
  APP_ADMIN_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  SESSION_TTL_SECONDS?: string;
}

export interface AppVariables {
  authenticated: boolean;
}
