const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

export interface Config {
  port: number;
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  uploadSigningKey: Uint8Array;
  publicBaseUrl?: string;
  maxUploadBytes: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const signingKey = required(env, "UPLOAD_SIGNING_KEY");
  if (Buffer.byteLength(signingKey) < 32) {
    throw new Error("UPLOAD_SIGNING_KEY must contain at least 32 bytes");
  }

  const publicBaseUrl = env.PUBLIC_BASE_URL?.replace(/\/+$/, "");

  return {
    port: positiveInteger(env.PORT, 3000, "PORT"),
    bucket: required(env, "S3_BUCKET"),
    endpoint: required(env, "S3_ENDPOINT"),
    region: env.S3_REGION?.trim() || "auto",
    accessKeyId: required(env, "S3_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "S3_SECRET_ACCESS_KEY"),
    forcePathStyle: env.S3_URL_STYLE?.toLowerCase() === "path",
    uploadSigningKey: new TextEncoder().encode(signingKey),
    ...(publicBaseUrl ? { publicBaseUrl } : {}),
    maxUploadBytes: positiveInteger(
      env.MAX_UPLOAD_BYTES,
      DEFAULT_MAX_UPLOAD_BYTES,
      "MAX_UPLOAD_BYTES",
    ),
  };
}

