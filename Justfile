# Just list all recipes by default
default:
    just --list

login:
    printf "${VSCODE_ACCESS_TOKEN}\n" | npx @vscode/vsce login dcastro

build:
    xrefcheck
    npx @vscode/vsce package

publish:
    npx @vscode/vsce publish

build-pre:
    xrefcheck
    npx @vscode/vsce package --pre-release

publish-pre:
    npx @vscode/vsce publish --pre-release
