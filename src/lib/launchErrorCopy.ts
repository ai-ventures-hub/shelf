/**
 * Plain-language messages for structured launch failure codes.
 * Shown in both modes — developers get the raw message alongside.
 */
import type { LaunchErrorCode } from '../types'

const COPY: Record<LaunchErrorCode, string> = {
  tool_not_found: 'This tool is no longer in the library.',
  folder_missing: "Shelf can't find this project's folder anymore.",
  no_launch_command: 'No launch command is set for this tool yet.',
  deps_missing: "This project's packages aren't installed yet.",
  runtime_missing: 'This Mac is missing a program this project needs to run.',
  docker_not_running: "Docker Desktop isn't running.",
  port_in_use: 'The port this tool wants is busy.',
  port_reassign_failed: "Shelf couldn't find a free port for this tool.",
  bad_launch_command: "The launch command doesn't match this project.",
  app_crashed: 'The app crashed right after starting.',
  port_timeout: 'The app started but never opened a page.',
  stop_refused_not_owner:
    "Another program owns that port, so Shelf left it alone.",
}

export function friendlyLaunchError(code: LaunchErrorCode): string {
  return COPY[code] || 'The launch failed.'
}
