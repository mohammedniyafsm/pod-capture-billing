import { SignJWT, jwtVerify } from "jose";

const IMAGE_URL_TTL_SECONDS = 5 * 60;
const ISSUER = "pod-capture";
const AUDIENCE = "pod-image";

function getSigningKey() {
  const secret = process.env.POD_IMAGE_URL_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "POD_IMAGE_URL_SECRET or a SESSION_SECRET of at least 32 characters is required.",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createPodImageToken(submissionId: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(submissionId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${IMAGE_URL_TTL_SECONDS}s`)
    .sign(getSigningKey());
}

export async function verifyPodImageToken(token: string, submissionId: string) {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return payload.sub === submissionId;
  } catch {
    return false;
  }
}

export const POD_IMAGE_URL_TTL_SECONDS = IMAGE_URL_TTL_SECONDS;
