import type { Plugin } from 'vite';
import { initService } from './generate';
import { context } from './context';
import type { Options } from './types';

const vitePlugin = (options: Options): Plugin => {
  let generator: Awaited<ReturnType<typeof initService>>;
  return {
    name: 'vite-plugin-link-preview',
    enforce: 'post',
    configResolved: async (config) => {
      const logger = context.get()?.logger;
      if (logger) {
        logger.info('config resolved');
      }
      generator = await initService({
        proxy: options.proxy,
        logger: logger,
        imageFormat: options.previewImageFormat,
      });
    },
    configureServer(server) {
      const urlCache = new Set<string>();

      server.middlewares.use((req, res, next) => {
        const url = req.url;

        if (url.startsWith('/_link-preview')) {
          if (urlCache.has(url)) {
            res.statusCode = 503;
            res.end();
            return; // 添加 return 防止执行后面的代码
          }

          urlCache.add(url);
          const rawHref = atob(url.replace('/_link-preview/', ''));

          generator
            .generate(rawHref)
            .then((buf: Buffer) => {
               if (buf.length === 0) {
                res.statusCode = 503;
                res.setHeader('Content-Type', `application/octet-stream`);
                 res.end();
                 return
             }

              res.setHeader('Content-Type', `application/octet-stream`);
              res.setHeader('Cache-Control', 'max-age=360000');
             res.end(buf);
              })
               .catch((error) => {
                    console.error('Generate error', error);
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'text/plain');
                    res.end('Internal Server Error');
                })
        } else {
          next();
        }
      });
    },
    async buildEnd() {
      await generator.dispose();
    },
  };
};

export { vitePlugin };