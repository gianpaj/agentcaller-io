import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServerEnv } from "./env";

let client: S3Client | undefined;

function r2Client() {
  if (!client) {
    const env = getServerEnv();
    client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });
  }
  return client;
}

/** Recordings live under a per-call prefix so a compromised agent cannot claim another call's object. */
export function recordingPrefix(callId: string) {
  return `recordings/${callId}/`;
}

export function isRecordingKeyForCall(key: string, callId: string) {
  return key.startsWith(recordingPrefix(callId)) && !key.includes("..");
}

export async function signedRecordingUrl(key: string) {
  const env = getServerEnv();
  return getSignedUrl(r2Client(), new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), { expiresIn: 300 });
}

export async function deleteRecording(key: string) {
  const env = getServerEnv();
  await r2Client().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
}
