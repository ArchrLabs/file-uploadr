import { jwtVerify, SignJWT } from "jose";
import { randomUUID } from "node:crypto";

const ISSUER = "file-uploadr";
const AUDIENCE = "file-uploadr:upload";
const SCOPE = "upload";

export interface IssueUploadTokenOptions {
  subject?: string;
  expiresIn?: string | number | Date;
}

export async function issueUploadToken(
  signingKey: Uint8Array,
  options: IssueUploadTokenOptions = {},
): Promise<string> {
  let token = new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(options.subject ?? "owner")
    .setIssuedAt()
    .setJti(randomUUID());

  if (options.expiresIn !== undefined) {
    token = token.setExpirationTime(options.expiresIn);
  }

  return token.sign(signingKey);
}

export async function verifyUploadToken(token: string, signingKey: Uint8Array): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, signingKey, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ["sub", "iat", "jti"],
    });

    return payload.scope === SCOPE;
  } catch {
    return false;
  }
}
