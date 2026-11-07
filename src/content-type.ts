const CONTENT_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  csv: "text/csv; charset=utf-8",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  html: "text/html; charset=utf-8",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  zip: "application/zip",
};

const GENERIC_CONTENT_TYPES = new Set(["application/octet-stream", "binary/octet-stream"]);

export function contentTypeForUpload(key: string, suppliedContentType?: string): string {
  if (suppliedContentType && !GENERIC_CONTENT_TYPES.has(suppliedContentType.toLowerCase())) {
    return suppliedContentType;
  }

  const extension = key.split(".").pop()?.toLowerCase();
  return (extension && CONTENT_TYPES[extension]) || "application/octet-stream";
}
