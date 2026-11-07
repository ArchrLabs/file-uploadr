import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "node:stream";

export interface PutObjectInput {
  key: string;
  body: Readable;
  contentType: string;
  contentLength?: number;
}

export interface ObjectMetadata {
  contentType: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
}

export interface StoredObject extends ObjectMetadata {
  body: Readable;
  contentRange?: string;
}

export interface ObjectStore {
  put(input: PutObjectInput): Promise<{ etag?: string }>;
  get(key: string, range?: string): Promise<StoredObject | undefined>;
  head(key: string): Promise<ObjectMetadata | undefined>;
}

export interface S3ObjectStoreOptions {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function isNotFound(error: unknown): boolean {
  if (error instanceof NoSuchKey || error instanceof NotFound) {
    return true;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function metadataFromS3(input: {
  ContentType?: string | undefined;
  ContentLength?: number | undefined;
  ETag?: string | undefined;
  LastModified?: Date | undefined;
}): ObjectMetadata {
  return {
    contentType: input.ContentType ?? "application/octet-stream",
    ...(input.ContentLength !== undefined ? { contentLength: input.ContentLength } : {}),
    ...(input.ETag !== undefined ? { etag: input.ETag } : {}),
    ...(input.LastModified !== undefined ? { lastModified: input.LastModified } : {}),
  };
}

export class S3ObjectStore implements ObjectStore {
  readonly #bucket: string;
  readonly #client: S3Client;

  constructor(options: S3ObjectStoreOptions) {
    this.#bucket = options.bucket;
    this.#client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(input: PutObjectInput): Promise<{ etag?: string }> {
    const upload = new Upload({
      client: this.#client,
      params: {
        Bucket: this.#bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ...(input.contentLength !== undefined ? { ContentLength: input.contentLength } : {}),
      },
    });

    const result = await upload.done();
    return result.ETag === undefined ? {} : { etag: result.ETag };
  }

  async get(key: string, range?: string): Promise<StoredObject | undefined> {
    try {
      const result = await this.#client.send(
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          ...(range ? { Range: range } : {}),
        }),
      );

      if (!(result.Body instanceof Readable)) {
        throw new Error("S3 returned an unsupported response body");
      }

      return {
        ...metadataFromS3(result),
        body: result.Body,
        ...(result.ContentRange !== undefined ? { contentRange: result.ContentRange } : {}),
      };
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async head(key: string): Promise<ObjectMetadata | undefined> {
    try {
      const result = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      return metadataFromS3(result);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }
}
