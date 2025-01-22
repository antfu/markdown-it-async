import type {
  PluginSimple as MarkdownItPluginSimple,
  PluginWithOptions as MarkdownItPluginWithOptions,
  PluginWithParams as MarkdownItPluginWithParams,
  Options,
  PresetName,
} from 'markdown-it'
import MarkdownIt from 'markdown-it'

export type PluginSimple = ((md: MarkdownItAsync) => void)
export type PluginWithOptions<T = any> = ((md: MarkdownItAsync, options?: T) => void)
export type PluginWithParams = ((md: MarkdownItAsync, ...params: any[]) => void)

export interface MarkdownItAsyncOptions extends Omit<Options, 'highlight'> {
  /**
   * Highlighter function for fenced code blocks.
   * Highlighter `function (str, lang, attrs)` should return escaped HTML. It can
   * also return empty string if the source was not changed and should be escaped
   * externally. If result starts with <pre... internal wrapper is skipped.
   * @default null
   */
  highlight?: ((str: string, lang: string, attrs: string) => string | Promise<string>) | null | undefined

  /**
   * Emit warning when calling `md.render` instead of `md.renderAsync`.
   *
   * @default false
   */
  warnOnSyncRender?: boolean
}

export type { MarkdownItAsyncOptions as Options }

const placeholder = (id: string): string => `<pre>::markdown-it-async::${id}::</pre>`
const placeholderRe = /<pre>::markdown-it-async::(\w+)::<\/pre>/g

function randStr(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

export type MarkdownItAsyncPlaceholderMap = Map<string, [promise: Promise<string>, str: string, lang: string, attrs: string]>

export class MarkdownItAsync extends MarkdownIt {
  placeholderMap: MarkdownItAsyncPlaceholderMap

  constructor(presetName: PresetName, options?: MarkdownItAsyncOptions)
  constructor(options?: MarkdownItAsyncOptions)
  constructor(...args: any[]) {
    const map: MarkdownItAsyncPlaceholderMap = new Map()
    const options = args.length === 2 ? args[1] : args[0]
    if (options && 'highlight' in options)
      options.highlight = wrapHightlight(options.highlight, map)
    super(...args as [])
    this.placeholderMap = map
  }

  use(plugin: PluginSimple): this
  use(plugin: MarkdownItPluginSimple): this
  use<T = any>(plugin: PluginWithOptions<T>, options?: T): this
  use<T = any>(plugin: MarkdownItPluginWithOptions<T>, options?: T): this
  use(plugin: PluginWithParams, ...params: any[]): this
  use(plugin: MarkdownItPluginWithParams, ...params: any[]): this
  // implementation
  use(plugin: any, ...params: any[]): this {
    return super.use(plugin, ...params)
  }

  render(src: string, env?: any): string {
    if ((this.options as MarkdownItAsyncOptions).warnOnSyncRender) {
      console.warn('[markdown-it-async] Please use `md.renderAsync` instead of `md.render`')
    }
    return super.render(src, env)
  }

  async renderAsync(src: string, env?: any): Promise<string> {
    this.options.highlight = wrapHightlight(this.options.highlight, this.placeholderMap)
    const result = super.render(src, env)
    return replaceAsync(result, placeholderRe, async (match, id) => {
      if (!this.placeholderMap.has(id))
        throw new Error(`Unknown highlight placeholder id: ${id}`)
      const [promise, _str, lang, _attrs] = this.placeholderMap.get(id)!
      const result = await promise || ''
      this.placeholderMap.delete(id)
      if (result.startsWith('<pre'))
        return result
      else
        return `<pre><code class="language-${lang}">${result}</code></pre>`
    })
  }
}

export function createMarkdownItAsync(presetName: PresetName, options?: MarkdownItAsyncOptions): MarkdownItAsync
export function createMarkdownItAsync(options?: MarkdownItAsyncOptions): MarkdownItAsync
export function createMarkdownItAsync(...args: any[]): MarkdownItAsync {
  return new MarkdownItAsync(...args)
}

// https://github.com/dsblv/string-replace-async/blob/main/index.js
export function replaceAsync(string: string, searchValue: RegExp, replacer: (...args: string[]) => Promise<string>): Promise<string> {
  try {
    if (typeof replacer === 'function') {
      const values: Promise<string>[] = []
      String.prototype.replace.call(string, searchValue, (...args) => {
        values.push(replacer(...args))
        return ''
      })
      return Promise.all(values).then((resolvedValues) => {
        return String.prototype.replace.call(string, searchValue, () => {
          return resolvedValues.shift() || ''
        })
      })
    }
    else {
      return Promise.resolve(
        String.prototype.replace.call(string, searchValue, replacer),
      )
    }
  }
  catch (error) {
    return Promise.reject(error)
  }
}

type NotNull<T> = T extends null | undefined ? never : T

const wrappedSet = new WeakSet<NotNull<Options['highlight']>>()

function wrapHightlight(highlight: MarkdownItAsyncOptions['highlight'], map: MarkdownItAsyncPlaceholderMap): Options['highlight'] {
  if (!highlight)
    return undefined

  if (wrappedSet.has(highlight as any))
    return highlight as any

  const wrapped: NotNull<Options['highlight']> = (str, lang, attrs) => {
    const promise = highlight(str, lang, attrs)
    if (typeof promise === 'string')
      return promise
    const id = randStr()
    map.set(id, [promise, str, lang, attrs])
    return placeholder(id)
  }

  wrappedSet.add(wrapped)
  return wrapped
}

export default createMarkdownItAsync
