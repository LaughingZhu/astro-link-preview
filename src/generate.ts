import { chromium } from 'playwright'
import type { LoggerType } from './logger'
import type { LaunchOptions } from 'playwright'

export interface GenerateServiceOptions {
  proxy: LaunchOptions['proxy']
  logger: LoggerType
  imageFormat: 'png' | 'jpg'
}

const GenerateService = async ({
  proxy,
  logger,
  imageFormat,
}: GenerateServiceOptions) => {
  const browser = await chromium.launch({
    proxy,
  })

  return {
    generate: async (href: string) => {
      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        await page.goto(href, { waitUntil: 'networkidle' })
        const imageBuf = await page.screenshot(
          imageFormat === 'jpg'
            ? {
                type: 'jpeg',
                quality: 75,
              }
            : {
                type: 'png',
              }
        )

        await context.close()
        return imageBuf
      } catch (e) {
        logger.error(
          `Crashed while trying to generate the screenshot of ${href}\n${e.message}`
        )
        await context.close()
        return Buffer.from([])
      }
    },
    dispose: async () => {
      await browser.close()
    },
  }
}

const initService = async (options: GenerateServiceOptions) => {
  const service = await GenerateService(options)
  return service
}
export type ImageGenerator = Awaited<ReturnType<typeof initService>>

export { initService }
