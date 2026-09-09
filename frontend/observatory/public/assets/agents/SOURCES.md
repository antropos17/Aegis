# Agent icons

Original downloaded files are preserved byte for byte; `sources.json` records exact URLs and SHA-256 hashes. The UI adds no background tiles and keeps each image's proportions. The monochrome Ollama image is displayed in white with CSS inversion in dark themes and in its original black in light themes.

- Claude: site icon served by [Claude](https://claude.com/) from its Sanity CDN.
- Cursor: official light/dark 2D cube SVGs from the asset archive on [Cursor's brand page](https://cursor.com/brand). The previously downloaded app PNG is retained but no longer displayed.
- Codex: original Codex app artwork distributed on [Ollama’s integration page](https://ollama.com/), `public/codex-app.png`. This copy is hosted by Ollama, not OpenAI.
- Ollama: logo from [Ollama](https://ollama.com/), `public/ollama.png`.

AEGIS uses the repository’s existing `assets/icon.svg`. Product names and logos belong to their respective owners. Inclusion here is for identification in the local interface prototype.

## Catalog icons (September 2026)

`catalog/sources.json` records downloaded website icons and repository artwork, final source URLs and SHA-256 hashes for each catalog ID. Files are preserved as downloaded. Shared product identities reuse existing local artwork. GitHub Copilot uses the official Primer Octicons asset and bundled MIT license. Selected dark monochrome icons use CSS inversion for contrast; image bytes remain unchanged.

104 of 110 catalog entries have sourced artwork. Shell-GPT, Mentat, Devin, BabyAGI, Smol Developer and Adept currently have no verified local artwork; they display a neutral missing-logo indicator, not a fabricated brand mark. Custom entries use the same neutral indicator. Site favicons identify the site's current brand, which can reflect a renamed product. Catalog metadata itself is unchanged.
