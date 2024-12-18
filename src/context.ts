import type { LoggerType } from './logger.js';
import type { LaunchOptions } from 'playwright.js'

export interface Context {
  logger: LoggerType
  proxy: LaunchOptions['proxy']
  imageFormat: 'png' | 'jpg'
}

const createContext = () => {
  let __ctx: Context

  return {
    set: (ctx: Context) => {
      __ctx = ctx
    },
    get: () => __ctx,
  }
}

const context = createContext()

export { context }
