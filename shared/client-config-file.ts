import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'

/** Preserve unrelated settings, reject stale edits, and keep config/backup owner-only. */
export function replaceClientConfig(configPath: string, nextText: string, expectedText: string): string | undefined {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  return withFileLockSync(configPath, () => {
    const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
    if (current !== expectedText) throw new Error('Client settings changed while Shelf was editing them. Retry to preserve the newer settings.')
    let backupPath: string | undefined
    if (current && current.trim() !== nextText.trim()) {
      backupPath = `${configPath}.shelf-backup`
      atomicWriteFileSync(backupPath, current)
    }
    const latest = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
    if (latest !== expectedText) throw new Error('Client settings changed before the write. Shelf kept the newer settings; retry.')
    atomicWriteFileSync(configPath, nextText.endsWith('\n') ? nextText : `${nextText}\n`)
    return backupPath
  })
}
