# Vibes documentation site

A dependency-free static homepage and documentation site for Vibes. Built for GitHub Pages at https://manyeya.github.io/vibes/.

## Build and preview

```sh
node apps/docs-site/build.mjs
python3 -m http.server 8080 --directory apps/docs-site/out
```

The build generates the homepage, documentation routes, search index, sitemap, favicon, and 404 page. It checks every local link and anchor before completing.

## Edit

- `content/pages.mjs`: Documentation content and navigation order.
- `build.mjs`: Shared templates and homepage.
- `assets/site.css`: Responsive styling and light/dark themes.
- `assets/site.js`: Search, keyboard navigation, copy buttons, mobile sidebar, and illustrative homepage sessions.

No provider keys, application server, or package install are required. The examples on the homepage are illustrative, not live model requests.

## Deploy

`.github/workflows/docs-pages.yml` builds the site on docs changes to `main`, uploads only `out/`, and deploys with GitHub Pages. The repository's Pages build type must be **GitHub Actions**. The workflow can also be run manually.

Internal links and assets use relative paths so they work beneath `/vibes/` as well as on a local preview server.
