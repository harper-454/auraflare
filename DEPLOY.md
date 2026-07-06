# AuraFlare — Ship It

## 1. Deploy to aura.massivenumber.com (Cloudflare)

Your zone `massivenumber.com` is already on Cloudflare, and `wrangler.jsonc`
declares `aura.massivenumber.com` as a custom domain — wrangler creates the
DNS record and TLS certificate automatically on first deploy.

```
npm install
npx wrangler login        # once
npm run deploy:cf         # builds + deploys the "auraflare" Worker
```

Live at **https://aura.massivenumber.com** (plus auraflare.<you>.workers.dev).
The edge deployment uses your paid stack automatically: Workers AI through
your AI Gateway, D1 persistence, KV caching, R2 model gallery.

Optional: `npx wrangler secret put GEMINI_API_KEY` if you want BYOK Gemini
at the edge as well.

## 2. Windows executable

- **Quick launcher:** double-click `AuraFlare.cmd` — builds once, serves at
  http://localhost:3000, opens your browser.
- **True .exe:** double-click `build-exe.cmd` — produces `AuraFlare.exe` via
  Node's Single Executable Application tooling. Keep the exe next to `dist/`
  and `.env.local`. It serves the full app including the local power tools
  (IDE filesystem, exec, gallery) that the edge version intentionally locks.

## Security note

The local server exposes `/api/exec` (shell) and `/api/fs` (files) with no
auth — that's the point of the desktop build, but never expose port 3000 to
the internet. The Cloudflare deployment returns 501 for those endpoints by
design.
