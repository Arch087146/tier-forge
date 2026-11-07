# Privacy policy

TierForge is a local desktop application. It has no telemetry, analytics, crash
reporting, advertising, or user accounts.

## Data stored on your computer

| Data | Location | Purpose |
| --- | --- | --- |
| Board state (tiers, item names, image URLs, theme, size) | WebView `localStorage`, key `tierforge.board.v1` | Restore your board between launches |
| Downloaded and imported images | `%LOCALAPPDATA%\com.tierforge.app\cache\images` | Display images without re-downloading |
| Recordings | `%USERPROFILE%\Videos\TierForge` | Save the MP4 files you record |
| API keys | Windows Credential Manager or macOS Keychain, service `com.tierforge.app` | Authenticate AI and image-search requests |

You can remove this data at any time: clear the board in the app, delete the
cache and recording folders, and clear the stored keys in Settings.

## Network requests

TierForge only contacts a network service when you explicitly start an AI
populate operation, import an image by URL, or use an image search. There is no
background traffic.

| Service | What is sent | When |
| --- | --- | --- |
| OpenAI, Google Gemini, or OpenRouter (the provider you select) | Your prompt, requested item count, and model parameters, authenticated with your API key | When you click **Generate** in the AI populate dialog |
| Openverse | Image search query and pagination parameters | While resolving images for generated items |
| Brave Image Search | Image search query, authenticated with your Brave API key | While resolving images, only if a Brave key is configured |
| Wikimedia Commons | Image search query | While resolving images |
| Image hosts returned by those providers | A standard HTTPS image download request | While caching the selected image |

TierForge does not send your board, recordings, or API keys to its own servers.
There are no TierForge servers.

The selected AI and image providers process requests under their own privacy
policies. Review the policy of the provider you configure.

## API keys

API keys are written to the operating system credential vault through the Rust
backend. They are never returned to the webview and are only attached to
requests to the provider you selected. The frontend only receives a boolean
indicating whether a key exists.

## Children

TierForge is a general-purpose productivity tool and is not directed at
children.

## Changes

Material changes to this policy will be published in this file and noted in the
release that introduces them.

## Contact

Open an issue at
[github.com/Arch087146/tier-forge/issues](https://github.com/Arch087146/tier-forge/issues).

_Last updated: 2026-11-07_
