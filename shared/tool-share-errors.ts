import type { ShareErrorCode } from './contracts'

export class ShareError extends Error {
  code: ShareErrorCode
  /** Plain-language fix, when one exists (e.g. how to install git). */
  remedy?: string
  /** A shell command the fix needs, offered as a one-click copy in the UI. */
  remedyCommand?: string
  constructor(code: ShareErrorCode, message: string, remedy?: string, remedyCommand?: string) {
    super(message)
    this.code = code
    this.remedy = remedy
    this.remedyCommand = remedyCommand
  }
}

export const GIT_MISSING_REMEDY =
  'Install Apple’s Command Line Tools: open Terminal, run `xcode-select --install`, finish the installer, then try again.'
