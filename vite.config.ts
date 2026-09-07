import { defineConfig } from 'vite';
import { writeFileSync } from 'node:fs';

/** Dev-only: lets the QA pass pull a frame out of the canvas. Not part of the build. */
const shotPlugin = {
  name: 'shot',
  apply: 'serve' as const,
  configureServer(server: { middlewares: { use: (p: string, h: (req: any, res: any) => void) => void } }) {
    server.middlewares.use('/__shot', (req: any, res: any) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c; });
      req.on('end', () => {
        const b64 = body.replace(/^data:image\/\w+;base64,/, '');
        writeFileSync(process.env.SHOT_PATH || '/tmp/shot.png', Buffer.from(b64, 'base64'));
        res.end('ok');
      });
    });
  },
};

export default defineConfig({ plugins: [shotPlugin] });
