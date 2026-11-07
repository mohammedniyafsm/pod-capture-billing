import { del, get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface StoredPodImage {
  body: ReadableStream<Uint8Array>;
  contentType: string;
}

export interface PodImageStorage {
  save(
    bytes: Uint8Array,
    mediaType: "image/jpeg" | "image/png" | "image/webp",
  ): Promise<string>;
  read(key: string): Promise<StoredPodImage | null>;
  remove(key: string): Promise<void>;
}

const localDirectory = resolve(process.cwd(), ".local-private-pods");
const keyPattern = /^[0-9a-f-]{36}\.(?:jpg|png|webp)$/i;

function validateKey(key: string) {
  if (!keyPattern.test(key)) throw new Error("Invalid private POD image key.");
}

function localPath(key: string) {
  validateKey(key);
  return join(localDirectory, key);
}

const localStorage: PodImageStorage = {
  async save(bytes, mediaType) {
    await mkdir(localDirectory, { recursive: true });
    const extension = mediaType === "image/jpeg" ? "jpg" : mediaType.slice("image/".length);
    const key = `${randomUUID()}.${extension}`;
    await writeFile(localPath(key), bytes, { flag: "wx" });
    return key;
  },
  async read(key) {
    try {
      const bytes = await readFile(localPath(key));
      return {
        body: Readable.toWeb(
          Readable.from([bytes]),
        ) as ReadableStream<Uint8Array>,
        contentType: key.endsWith(".webp")
          ? "image/webp"
          : key.endsWith(".png")
            ? "image/png"
            : "image/jpeg",
      };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  },
  async remove(key) {
    try {
      await rm(localPath(key));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  },
};

const vercelBlobStorage: PodImageStorage = {
  async save(bytes, mediaType) {
    const extension = mediaType === "image/jpeg" ? "jpg" : mediaType.slice("image/".length);
    const result = await put(
      `private-pods/${randomUUID()}.${extension}`,
      Buffer.from(bytes),
      {
        access: "private",
        contentType: mediaType,
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
      },
    );
    return result.pathname;
  },
  async read(key) {
    const blob = await get(key, { access: "private", useCache: false });
    if (!blob || blob.statusCode !== 200) return null;
    return { body: blob.stream, contentType: blob.blob.contentType };
  },
  async remove(key) {
    await del(key);
  },
};

export function getPodImageStorage(): PodImageStorage {
  return process.env.NODE_ENV === "production"
    ? vercelBlobStorage
    : localStorage;
}
