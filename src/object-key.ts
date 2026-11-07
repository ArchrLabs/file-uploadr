import { randomBytes } from "node:crypto";

const MAX_KEY_BYTES = 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const SAFE_EXTENSION = /^[a-z\d]{1,16}$/u;

export class InvalidObjectKeyError extends Error {}

export function objectKeyFromPathname(pathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new InvalidObjectKeyError("The URL contains invalid percent encoding");
  }

  const key = decoded.replace(/^\/+/, "");
  const segments = key.split("/");

  if (
    key.length === 0 ||
    key.endsWith("/") ||
    key.includes("\\") ||
    CONTROL_CHARACTERS.test(key) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new InvalidObjectKeyError("The file path is invalid");
  }

  if (Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES) {
    throw new InvalidObjectKeyError("The file path exceeds 1024 bytes");
  }

  return key;
}

export function encodeObjectKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z\d]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120)
    .replace(/-+$/u, "");

  return slug || "file";
}

/** Create an immutable object key while preserving an optional parent path. */
export function uniqueObjectKey(requestedKey: string): string {
  const segments = requestedKey.split("/");
  const requestedFilename = segments.pop();
  if (!requestedFilename) {
    throw new InvalidObjectKeyError("The file path is invalid");
  }

  const extensionIndex = requestedFilename.lastIndexOf(".");
  const possibleExtension =
    extensionIndex > 0 ? requestedFilename.slice(extensionIndex + 1).toLowerCase() : "";
  const extension = SAFE_EXTENSION.test(possibleExtension) ? possibleExtension : "";
  const basename = extension
    ? requestedFilename.slice(0, -(extension.length + 1))
    : requestedFilename;
  const suffix = randomBytes(6).toString("base64url");
  const filename = `${slugify(basename)}-${suffix}${extension ? `.${extension}` : ""}`;

  return [...segments, filename].join("/");
}
