import type { AstroIntegration, AstroConfig, Page } from 'astro'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { xxh32 } from '@node-rs/xxhash'
import type { Options } from './types.js'
import { createLogger } from './logger.js'
import { initService } from './generate.js'
import { optimize } from './optimize.js'
import { vitePlugin } from './vite-plugin-link-preview.js'
import { context } from './context.js'
import path from 'node:path'
import { RewritingStream } from 'parse5-html-rewriting-stream'
import { pipeline } from 'node:stream/promises'
import { isValidURL } from './url.js'
import { Readable } from 'node:stream'
import { routeConfigPlugin } from './vite-plugin-config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const injectedScriptPath = path.join(__dirname, 'script.mjs')
const injectedScript = await readFile(injectedScriptPath, { encoding: 'utf-8' })

const parseAndWrite = async (
  pathHref: string,
  cache: Map<string, number>,
  logger: ReturnType<typeof createLogger>
) => {
  try {
    const rawHtmlStr = await readFile(pathHref, { encoding: 'utf-8' })
    const readStream = Readable.from([rawHtmlStr])
    const writeStream = createWriteStream(pathHref, {
      encoding: 'utf-8',
    })
    const rewriterStream = new RewritingStream()

    rewriterStream.on('startTag', startTag => {
      if (startTag.tagName === 'a') {
        const href = startTag.attrs.find(attr => attr.name === 'href')?.value

        if (href && typeof href === 'string' && isValidURL(href)) {
          if (cache.has(href)) {
            startTag.attrs.push({
              name: 'data-link-preview',
              value: `${cache.get(href)}`,
            })
          } else {
            const hashed = xxh32(href)
            cache.set(href, hashed)
            startTag.attrs.push({
              name: 'data-link-preview',
              value: `${hashed}`,
            })
          }
        }
      }

      rewriterStream.emitStartTag(startTag)
    })

    await pipeline(readStream, rewriterStream, writeStream)
  } catch (error) {
    logger.error(
      `Crashed while trying to parse the HTML of ${pathHref}\n${
        error instanceof Error ? error.message : String(error)
      }`
    )
    throw error
  }
}

const calcPagePaths = (
  pages: any[],
  buildFormat: 'file' | 'directory' | 'preserve'
) => {
  if (buildFormat === 'directory') {
    return pages.map(page => {
      if (page.pathname === '404/') {
        return '404.html'
      }
      return `${page.pathname}index.html`
    })
  }

  return pages.map(page => {
    if (page.pathname === '' || page.pathname.endsWith('/')) {
      return `${page.pathname}index.html`
    }

    if (page.pathname === '404') {
      return '404.html'
    }

    return `${page.pathname}.html`
  })
}

const generatePreviewImage = async (
  href: string,
  hashed: number,
  generator: Awaited<ReturnType<typeof initService>>,
  dir: URL,
  previewImageFormat: 'jpg' | 'png',
  logger: ReturnType<typeof createLogger>
) => {
  try {
    const imageBuf = await generator.generate(href).then(optimize)
    if (!imageBuf) {
      logger.error(`Failed to generate image for ${href}`)
      return
    }
    const imageData =
      imageBuf instanceof Buffer ? new Uint8Array(imageBuf.buffer) : imageBuf
    const imagePath = new URL(`./${hashed}.${previewImageFormat}`, dir)
    await mkdir(path.dirname(imagePath.pathname), { recursive: true })
    await writeFile(imagePath, imageData)
    logger.info(
      `Generated preview image for ${href} : ${imagePath.pathname}`
    )
  } catch (e) {
    logger.error(
      `Crashed while trying to generate the screenshot of ${href}\n${
        e instanceof Error ? e.message : String(e)
      }`
    )
    throw e
  }
}

const integration = (options: Options = {}): AstroIntegration => {
  const {
    logStats = true,
    proxy,
    previewImageFormat = 'jpg',
    enableOnMobile = false,
  } = options

  if (!['jpg', 'png'].includes(previewImageFormat)) {
    throw new Error(`Invalid preview image format: ${previewImageFormat}`)
  }

  const logger = createLogger(logStats)

  context.set({
    logger,
    proxy,
    imageFormat: previewImageFormat,
  })

  /**
   * cache links and hashes
   */
  const linkAndHashCache = new Map<string, number>()

  let astroConfig: AstroConfig

  return {
    name: 'astro-link-preview',
    hooks: {
      'astro:config:setup': ({ updateConfig, injectScript, config }) => {
        const isSSR = config.output === 'server'

        const updateScriptByFormat = (script: string) => {
          return previewImageFormat === 'jpg'
            ? script.replace('{hashed}.png', '{hashed}.jpg')
            : script
        }

        const updateScriptByMobile = (script: string) => {
          return enableOnMobile
            ? script.replace('enableOnMobile = false', 'enableOnMobile = true')
            : script
        }

        const updateScriptByMode = (script: string) => {
          return isSSR
            ? script.replace('const isSsr = false', 'const isSsr = true')
            : script
        }

        const scriptUpdater = [
          updateScriptByFormat,
          updateScriptByMobile,
          updateScriptByMode,
        ].reduce((prev, curr) => (s: string) => curr(prev(s)))

        injectScript('page', scriptUpdater(injectedScript))

        updateConfig({
          vite: {
            plugins: [
              vitePlugin(options),
              isSSR &&
                routeConfigPlugin({
                  proxy: proxy,
                  logStats: logStats,
                  previewImageFormat: previewImageFormat,
                }),
            ].filter(Boolean),
          },
        })
      },

      'astro:config:done': ({ config }) => {
        astroConfig = config
      },

      'astro:build:done': async ({ dir, pages }) => {
        if (astroConfig.output === 'server') {
          return
        }

        logger.info(`Generating preview images...`)

        const buildFormat =
          astroConfig.build.format === 'file' ||
          astroConfig.build.format === 'directory'
            ? astroConfig.build.format
            : 'file'

        const hrefs = calcPagePaths(pages, buildFormat)
          .map(path => new URL(path, dir).href)
          .filter(h => h.endsWith('.html'))

        const paths = hrefs.map(fileURLToPath)
        await Promise.all(
          paths.map(async path => {
            try {
              await parseAndWrite(path, linkAndHashCache, logger)
            } catch (e) {
              logger.error(
                `Crashed while trying to parse the HTML of ${path}\n${
                  e instanceof Error ? e.message : String(e)
                }`
              )
            }
          })
        )

        const generator = await initService({
          proxy: options.proxy,
          logger: logger,
          imageFormat: previewImageFormat,
        })
        const arr = [...linkAndHashCache]

        await Promise.all(
          arr.map(async ([href, hashed]) => {
            try {
              await generatePreviewImage(
                href,
                hashed,
                generator,
                dir,
                previewImageFormat,
                logger
              )
            } catch (e) {
              logger.error(
                `Crashed while trying to generate the screenshot of ${href}\n${
                  e instanceof Error ? e.message : String(e)
                }`
              )
            }
          })
        )
        await generator.dispose()
      },
    },
  }
}

export default integration
