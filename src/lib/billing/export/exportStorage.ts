import { del, get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";

const localDirectory = resolve(process.cwd(), ".local-private-exports");
const keyPattern = /^[0-9a-f-]{36}\.zip$/i;

function localPath(key: string) {
  if (!keyPattern.test(key)) throw new Error("Invalid private export key.");
  return join(localDirectory, key);
}

export interface ExportStorage {
  save(bytes: Uint8Array): Promise<string>;
  read(key: string): Promise<ReadableStream<Uint8Array> | null>;
  remove(key: string): Promise<void>;
}

const localStorage: ExportStorage = {
  async save(bytes) {
    await mkdir(localDirectory, { recursive: true });
    const key = `${randomUUID()}.zip`;
    await writeFile(localPath(key), bytes, { flag: "wx" });
    return key;
  },
  async read(key) {
    try {
      const bytes = await readFile(localPath(key));
      return Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  },
  async remove(key) {
    try {
      await rm(localPath(key));
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  },
};

const blobStorage: ExportStorage = {
  async save(bytes) {
    const result = await put(
      `private-exports/${randomUUID()}.zip`,
      Buffer.from(bytes),
      {
        access: "private",
        contentType: "application/zip",
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
      },
    );
    return result.pathname;
  },
  async read(key) {
    const result = await get(key, { access: "private", useCache: false });
    return result?.statusCode === 200 ? result.stream : null;
  },
  async remove(key) {
    await del(key);
  },
};

export function getExportStorage(): ExportStorage {
  return process.env.NODE_ENV === "production" ? blobStorage : localStorage;
}
