// Formats an uploaded file path as text that can be pasted at a shell prompt
// or into an agent prompt. Roamgate cannot tell which shell a pane runs, so
// the result is chosen to read the same way in bash, zsh, fish, PowerShell,
// and Git Bash. Paths made only of safe characters stay bare so agents that
// detect image paths keep recognizing them.
const SAFE_PATH = /^[A-Za-z0-9_\-.,/:@%+=]+$/;

export function terminalPathText(path: string, platform: NodeJS.Platform) {
  if (platform === "win32") {
    // Bash treats backslashes as escapes; Windows APIs, PowerShell, and Git
    // Bash all accept forward slashes.
    const slashed = path.replaceAll("\\", "/");
    if (SAFE_PATH.test(slashed)) return slashed;
    if (!slashed.includes("'")) return `'${slashed}'`;
    // Windows paths cannot contain double quotes. Double quotes still expand
    // `$` in both shells and backticks in PowerShell.
    if (!/[$`]/.test(slashed)) return `"${slashed}"`;
    // No quoting is literal in both shells here; prefer PowerShell, the
    // Windows default.
    return `'${slashed.replaceAll("'", "''")}'`;
  }
  if (SAFE_PATH.test(path)) return path;
  return `'${path.replaceAll("'", "'\\''")}'`;
}
