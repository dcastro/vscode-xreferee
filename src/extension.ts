import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node';

export function activate(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = [{ scheme: 'file' }];

  const serverOptions: ServerOptions = {
    command: 'lsp-xreferee',
    args: [],
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
  void client.start();

  // Ensure the client is stopped when the extension is deactivated/unloaded.
  context.subscriptions.push({
    dispose: () => {
      void client.stop();
    },
  });
}

export function deactivate() {
  // no-op
}
