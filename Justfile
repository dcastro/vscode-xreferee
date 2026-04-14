# Just list all recipes by default
default:
    just --list

build:
    npx @vscode/vsce package
