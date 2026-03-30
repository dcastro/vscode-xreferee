import * as vscode from 'vscode';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import extractZip = require('extract-zip');
import * as tar from 'tar';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node';

const LSP_COMMAND = 'lsp-xreferee';
const LSP_REPO_OWNER = 'dcastro';
const LSP_REPO_NAME = 'lsp-xreferee';
const LOG_CHANNEL_NAME = 'xreferee';
const LSP_VERSION_FILE_NAME = 'lsp-xreferee-version.txt';
const EXTENSION_CONFIG_SECTION = 'xreferee';
const SERVER_ARGS_SETTING_KEY = 'serverArgs';
const octokitModulePromise = import('@octokit/rest');

let logChannel: vscode.OutputChannel | undefined;

/**
 * Activates the extension and starts the language client once the server executable is available.
 */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  logChannel = vscode.window.createOutputChannel(LOG_CHANNEL_NAME);
  context.subscriptions.push(logChannel);
  logInfo('Extension activation started.');

  const selector: vscode.DocumentSelector = [{ scheme: 'file' }];

  // Resolve the language server executable before creating the client.
  let serverCommand: string;
  const serverArgs = getConfiguredServerArgs();
  try {
    logInfo('Resolving language server executable.');
    serverCommand = await resolveServerCommand(context);
    logInfo(`Using language server executable: ${serverCommand}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError('Failed to resolve language server executable.', error);
    void vscode.window.showErrorMessage(
      `Failed to initialize xreferee language server: ${message}`,
    );
    return;
  }

  const serverOptions: ServerOptions = {
    command: serverCommand,
    args: serverArgs,
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: selector as any,
  };

  const client = new LanguageClient(
    'xreferee',
    'xreferee LSP',
    serverOptions,
    clientOptions,
  );
  // Start the client (manages didOpen/didChange and request routing to the server).
  logInfo('Starting language client.');
  void client.start();
  logInfo('Language client start requested.');

  // Ensure the client is stopped when the extension is deactivated/unloaded.
  context.subscriptions.push({
    dispose: () => {
      logInfo('Stopping language client.');
      void client.stop();
    },
  });
}

/**
 * Reads user-configured extra command-line arguments for the language server.
 */
function getConfiguredServerArgs(): string[] {
  const configuredValue = vscode.workspace
    .getConfiguration(EXTENSION_CONFIG_SECTION)
    .get<unknown>(SERVER_ARGS_SETTING_KEY, []);

  if (
    Array.isArray(configuredValue) &&
    configuredValue.every((value) => typeof value === 'string')
  ) {
    logInfo(
      `Configured ${SERVER_ARGS_SETTING_KEY}: ${JSON.stringify(configuredValue)}`,
    );
    return configuredValue;
  }

  logError(
    `Invalid setting '${EXTENSION_CONFIG_SECTION}.${SERVER_ARGS_SETTING_KEY}'. Expected an array of strings.`,
    configuredValue,
  );
  void vscode.window.showWarningMessage(
    `Invalid setting '${EXTENSION_CONFIG_SECTION}.${SERVER_ARGS_SETTING_KEY}'. Expected an array of strings.`,
  );
  return [];
}

/**
 * Returns an executable command path for the language server.
 * It prefers the command already available in PATH and otherwise downloads the latest release binary.
 */
async function resolveServerCommand(
  context: vscode.ExtensionContext,
): Promise<string> {
  // First try the user's existing PATH.
  logInfo('Checking PATH for existing lsp-xreferee executable.');
  const existingCommand = findExecutableInPath();
  if (existingCommand) {
    logInfo(`Found executable in PATH: ${existingCommand}`);
    return existingCommand;
  }

  // Fallback to the managed binary path (cached download or fresh download).
  logInfo(
    'Executable not found in PATH. Resolving managed language server binary.',
  );
  return downloadLatestServerBinary(context);
}

/**
 * Searches process PATH for an executable with the given command name.
 */
function findExecutableInPath(): string | undefined {
  // Build the executable file name based on platform conventions.
  const exeName = getExecutableName();
  const lookupTool = process.platform === 'win32' ? 'where' : 'which';
  logInfo(`Checking executable with ${lookupTool}: ${exeName}`);

  // Ask the operating system to resolve the command from PATH.
  try {
    const output = execFileSync(lookupTool, [exeName], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const resolvedPath = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (resolvedPath && isUsableExecutable(resolvedPath)) {
      logInfo(`Resolved executable path: ${resolvedPath}`);
      return resolvedPath;
    }
  } catch {
    // Non-zero exit means executable was not found.
  }

  logInfo('No executable found in PATH.');
  return undefined;
}

/**
 * Returns the platform-specific executable name for PATH lookups.
 */
function getExecutableName(): string {
  if (process.platform === 'win32') {
    return `${LSP_COMMAND}.exe`;
  }

  return LSP_COMMAND;
}

/**
 * Checks whether the path points to an executable file.
 */
function isUsableExecutable(filePath: string): boolean {
  // Windows does not require an execute bit; file existence is enough.
  const accessMode =
    process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;
  try {
    fs.accessSync(filePath, accessMode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads the latest release binary for the current platform and returns its local path.
 */
async function downloadLatestServerBinary(
  context: vscode.ExtensionContext,
): Promise<string> {
  // Resolve the expected release archive for this runtime platform/architecture.
  const assetName = getReleaseAssetNameForRuntime();
  const expectedBinaryName = getExecutableName();
  logInfo(`Resolved release asset name: ${assetName}`);
  logInfo(`Expected binary inside release package: ${expectedBinaryName}`);

  // Reuse a previously downloaded binary if present.
  const installDir = context.globalStorageUri.fsPath;
  logInfo(`Ensuring install directory exists: ${installDir}`);
  await fs.promises.mkdir(installDir, { recursive: true });
  const localBinaryPath = path.join(installDir, getExecutableName());
  const versionFilePath = path.join(installDir, LSP_VERSION_FILE_NAME);

  // Fetch latest release metadata and locate the matching asset.
  const latestRelease = await getLatestRelease();
  const latestReleaseVersion =
    typeof latestRelease.tag_name === 'string'
      ? latestRelease.tag_name
      : (() => {
          throw new Error('Latest release is missing a valid release name.');
        })();

  if (isUsableExecutable(localBinaryPath)) {
    const installedVersion = await readInstalledVersion(versionFilePath);
    // If we have the latest version installed, reuse it.
    // Otherwise, we'll redownload and replace the binary.
    if (installedVersion === latestReleaseVersion) {
      logInfo(
        `Using previously downloaded executable at version '${installedVersion}': ${localBinaryPath}`,
      );
      return localBinaryPath;
    }

    logInfo(
      `Installed binary version '${installedVersion ?? 'unknown'}' differs from latest '${latestReleaseVersion}'. Updating binary.`,
    );
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Downloading lsp-xreferee language server',
    },
    async () => {
      const asset = latestRelease.assets.find(
        (entry) => entry.name === assetName,
      );
      if (!asset) {
        throw new Error(
          `Latest release does not contain asset '${assetName}' for ${process.platform}/${process.arch}.`,
        );
      }
      logInfo(`Matched release asset: ${asset.name}`);

      // Download archive to a temporary file, extract it, and move the binary into place.
      const tempArchivePath = path.join(installDir, `${assetName}.download`);
      const tempExtractDir = path.join(
        installDir,
        `extract-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      try {
        logInfo(`Downloading archive to temporary file: ${tempArchivePath}`);
        await downloadReleaseAsset(asset.id, tempArchivePath);

        logInfo(`Extracting archive to temporary directory: ${tempExtractDir}`);
        await fs.promises.mkdir(tempExtractDir, { recursive: true });
        await extractArchivePackage(assetName, tempArchivePath, tempExtractDir);

        const extractedBinaryPath = path.join(
          tempExtractDir,
          expectedBinaryName,
        );
        try {
          await fs.promises.access(extractedBinaryPath, fs.constants.F_OK);
        } catch {
          throw new Error(
            `Could not find '${expectedBinaryName}' inside extracted archive '${assetName}'.`,
          );
        }
        logInfo(`Found extracted binary: ${extractedBinaryPath}`);

        logInfo(`Replacing previous binary at: ${localBinaryPath}`);
        await fs.promises.rm(localBinaryPath, { force: true });
        await fs.promises.rename(extractedBinaryPath, localBinaryPath);
        await writeInstalledVersion(versionFilePath, latestReleaseVersion);
        logInfo(`Downloaded executable is ready: ${localBinaryPath}`);
        logInfo(`Persisted installed version: ${latestReleaseVersion}`);
        return localBinaryPath;
      } catch (error) {
        await fs.promises.rm(tempArchivePath, { force: true });
        await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
        logError(
          'Failed to download and install language server binary.',
          error,
        );
        throw error;
      } finally {
        await fs.promises.rm(tempArchivePath, { force: true });
        await fs.promises.rm(tempExtractDir, { recursive: true, force: true });
      }
    },
  );
}

/**
 * Reads the installed binary version from disk.
 */
async function readInstalledVersion(
  versionFilePath: string,
): Promise<string | undefined> {
  try {
    const content = await fs.promises.readFile(versionFilePath, 'utf8');
    const version = content.trim();
    return version || undefined;
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Writes the installed binary version to disk.
 */
async function writeInstalledVersion(
  versionFilePath: string,
  version: string,
): Promise<void> {
  await fs.promises.writeFile(versionFilePath, `${version}\n`, 'utf8');
}

/**
 * Maps the current Node runtime platform and architecture to a release asset name.
 */
function getReleaseAssetNameForRuntime(): string {
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return 'lsp-xreferee-macos-amd64.tar.gz';
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'lsp-xreferee-macos-arm64.tar.gz';
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return 'lsp-xreferee-ubuntu-amd64.tar.gz';
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return 'lsp-xreferee-ubuntu-arm64.tar.gz';
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'lsp-xreferee-windows-amd64.zip';
  }
  if (process.platform === 'win32' && process.arch === 'arm64') {
    return 'lsp-xreferee-windows-arm64.zip';
  }

  throw new Error(
    `Unsupported platform/architecture combination: ${process.platform}/${process.arch}.`,
  );
}

/**
 * Extracts a downloaded release archive (.zip or .tar.gz) into a destination directory.
 */
async function extractArchivePackage(
  assetName: string,
  archivePath: string,
  destinationDir: string,
): Promise<void> {
  if (assetName.endsWith('.zip')) {
    await extractZip(archivePath, { dir: destinationDir });
    return;
  }

  if (assetName.endsWith('.tar.gz')) {
    await tar.x({
      file: archivePath,
      cwd: destinationDir,
    });
    return;
  }

  throw new Error(`Unsupported archive format for asset '${assetName}'.`);
}

/**
 * Fetches latest release metadata from GitHub via Octokit.
 *
 * curl https://api.github.com/repos/dcastro/lsp-xreferee/releases/latest
 */
async function getLatestRelease() {
  logInfo(
    `Fetching latest release metadata via Octokit for ${LSP_REPO_OWNER}/${LSP_REPO_NAME}.`,
  );

  const octokit = await createOctokitClient();
  const response = await octokit.rest.repos.getLatestRelease({
    owner: LSP_REPO_OWNER,
    repo: LSP_REPO_NAME,
  });
  logInfo(`GitHub API request succeeded (${response.status}): latest release`);
  return response.data;
}

/**
 * Downloads a release asset by id through Octokit and writes it to a file.
 */
async function downloadReleaseAsset(
  assetId: number,
  destinationPath: string,
): Promise<void> {
  logInfo(`Starting asset download via Octokit: asset_id=${assetId}`);

  const octokit = await createOctokitClient();
  const response = await octokit.request(
    'GET /repos/{owner}/{repo}/releases/assets/{asset_id}',
    {
      owner: LSP_REPO_OWNER,
      repo: LSP_REPO_NAME,
      asset_id: assetId,
      headers: {
        accept: 'application/octet-stream',
      },
    },
  );
  logInfo(
    `GitHub API request succeeded (${response.status}): release asset ${assetId}`,
  );

  await fs.promises.writeFile(
    destinationPath,
    normalizeBinaryResponse(response.data),
  );
  logInfo(`Finished file download to: ${destinationPath}`);
}

/**
 * Creates an Octokit client for GitHub API requests.
 */
async function createOctokitClient() {
  const { Octokit } = await octokitModulePromise;

  const authToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return new Octokit({
    auth: authToken,
    userAgent: 'vscode-xreferee',
  });
}

/**
 * Converts Octokit binary response data into a Node.js Buffer.
 */
function normalizeBinaryResponse(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  if (typeof data === 'string') {
    return Buffer.from(data, 'binary');
  }

  throw new Error(
    'Unexpected response payload while downloading release asset.',
  );
}

/**
 * Writes an informational message to the extension output channel.
 */
function logInfo(message: string): void {
  if (!logChannel) {
    return;
  }

  logChannel.appendLine(`[xreferee] ${message}`);
}

/**
 * Writes an error message to the extension output channel.
 */
function logError(message: string, error: unknown): void {
  if (!logChannel) {
    return;
  }

  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  logChannel.appendLine(`[xreferee] ERROR: ${message}`);
  logChannel.appendLine(`[xreferee] ERROR DETAIL: ${detail}`);
}

export function deactivate() {
  // no-op
}
