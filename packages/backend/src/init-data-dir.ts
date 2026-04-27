import fs from 'fs';
import path from 'path';

const DATA_DIR = '.tasks_manager';

/**
 * Create the data directory and write a .gitignore inside it
 * so the directory self-ignores without touching the repo's root .gitignore.
 */
export function initDataDir(repoRoot: string): string {
  const dataDir = path.join(repoRoot, DATA_DIR);
  fs.mkdirSync(dataDir, { recursive: true });

  const gitignorePath = path.join(dataDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '*\n');
  }

  return dataDir;
}
