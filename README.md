# vscode-xreferee

Validate cross references throughout a git repo.

This vscode extension is an adapter for the [xreferee CLI tool](https://github.com/brandonchinn178/xreferee).

## Overview

It's often useful to link two different locations in a codebase, and it might not always be possible to enforce it by importing a common source of truth. Some examples:
* Keeping two constants in sync across files in two different languages
* Linking an implementation to markdown files or comments documenting the design
* Referencing an invariant documented on a field definition at the call-site

See GHC's wiki on how they've found cross references helpful: https://gitlab.haskell.org/ghc/ghc/-/wikis/commentary/coding-style#2-using-notes.

You can use this tool to validate that cross references across a repository are valid. For example:

```markdown
This is a _markdown_ **file** documenting a feature.
We can mark this as a source of truth with a Markdown comment:
<!-- #(ref:my-feature) -->
```

```python
# In my Python code, add a reference to the markdown document, where
# you know you can just search for a matching anchor tag
# See @(ref:my-feature)
def my_feature():
    pass

# Maybe the Python file is also the source of truth for a constant:
# #(ref:my-version-123)
MY_VERSION = 123
```

```javascript
// Then in my Javascript file, we can use a cross reference to ensure they're
// kept in sync. If the label above is updated to `my-version-124`, then this
// cross reference will be broken, and xreferee will flag it.
// @(ref:my-version-123)
const MY_VERSION = 123
```

## Features

* Go To Definition: navigate from a reference to its anchor.
* Find All References: navigate from an anchor to its references.
* Diagnostics: reports warnings/errors for unused anchors, duplicate anchors, and broken references.
* Rename labels, updating all associated anchors/references.

These features are provided by the [xreferee LSP server](https://github.com/dcastro/lsp-xreferee).
This extension automatically downloads the [latest release](https://github.com/dcastro/lsp-xreferee/releases) if the `lsp-xreferee` binary is not found in your `PATH`.

## Extension Settings

This extension contributes the following setting:

- `xreferee.serverArgs`: Additional command-line arguments passed to the `lsp-xreferee` process.

Example:

```json
{
	"xreferee.serverArgs": "--log-file <file>"
}
```


## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for release history.
