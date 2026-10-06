import type { Plugin } from 'vite'
import { sourceEntry } from './package-root.js'

function shell(entry: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>open-dashboard</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Crect x='2' y='10' width='4' height='8' rx='1' fill='%232a78d6'/%3E%3Crect x='8' y='5' width='4' height='13' rx='1' fill='%231baf7a'/%3E%3Crect x='14' y='2' width='4' height='16' rx='1' fill='%23eb6834'/%3E%3C/svg%3E">
<script>try{var t=localStorage.getItem('odd:theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body>
<div id="root"></div>
<script type="module" src="/@fs${entry}"></script>
</body>
</html>
`
}

/**
 * The viewer lives inside this package while dashboards live in the user's
 * workspace, so Vite's root stays the workspace and the app entry is reached
 * through /@fs. Any other arrangement puts `dashboards/` outside the root and
 * breaks relative imports inside a dashboard.
 */
export function appPlugin(): Plugin {
  const entry = sourceEntry('app', 'main.tsx')
  return {
    name: 'open-dashboard:app',
    configureServer(server) {
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url || req.method !== 'GET') return next()
          const [path] = req.url.split('?')
          if (path?.includes('.') || path?.startsWith('/@') || path?.startsWith('/__odd'))
            return next()
          const html = await server.transformIndexHtml(req.url, shell(entry))
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        })
      }
    },
  }
}
