/**
 * Filesystem-backed SpecStore for local development.
 * Reads/writes spec files from a directory on disk.
 */

import { readFile, writeFile, unlink, readdir, mkdir } from 'fs/promises'
import { join } from 'path'
import type { SpecStore } from '../types'

export class LocalSpecStore implements SpecStore {
  constructor(private readonly dir: string) {}

  async get(key: string): Promise<ArrayBuffer | null> {
    try {
      const buf = await readFile(join(this.dir, key))
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    } catch {
      return null
    }
  }

  async put(key: string, data: ArrayBuffer): Promise<void> {
    const filePath = join(this.dir, key)
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, Buffer.from(data))
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(join(this.dir, key))
    } catch {
      // ignore if file doesn't exist
    }
  }

  async list(): Promise<string[]> {
    try {
      return await readdir(this.dir, { recursive: true }) as string[]
    } catch {
      return []
    }
  }
}
