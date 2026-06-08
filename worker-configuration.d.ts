/* eslint-disable */
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./src/index")
  }
  interface Env {
    BSKY_IDENTIFIER: string
    BSKY_PASSWORD: string
    BSKY_SERVICE_URL?: string
    FREESTUFF_PUBLIC_KEY: string
  }
}
interface CloudflareBindings extends Cloudflare.Env {}
type StringifyValues<EnvType extends Record<string, unknown>> = {
  [Binding in keyof EnvType]: EnvType[Binding] extends string ? EnvType[Binding] : string
}
declare namespace NodeJS {
  interface ProcessEnv extends StringifyValues<Pick<Cloudflare.Env, "BSKY_IDENTIFIER" | "BSKY_PASSWORD" | "BSKY_SERVICE_URL" | "FREESTUFF_PUBLIC_KEY">> {}
}
