import { onRequestPost as __api_login_ts_onRequestPost } from "D:\\杂\\音乐播放器\\Solara\\functions\\api\\login.ts"
import { onRequest as __api_storage_ts_onRequest } from "D:\\杂\\音乐播放器\\Solara\\functions\\api\\storage.ts"
import { onRequest as __palette_ts_onRequest } from "D:\\杂\\音乐播放器\\Solara\\functions\\palette.ts"
import { onRequest as __proxy_ts_onRequest } from "D:\\杂\\音乐播放器\\Solara\\functions\\proxy.ts"
import { onRequest as ___middleware_ts_onRequest } from "D:\\杂\\音乐播放器\\Solara\\functions\\_middleware.ts"

export const routes = [
    {
      routePath: "/api/login",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_login_ts_onRequestPost],
    },
  {
      routePath: "/api/storage",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_storage_ts_onRequest],
    },
  {
      routePath: "/palette",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__palette_ts_onRequest],
    },
  {
      routePath: "/proxy",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__proxy_ts_onRequest],
    },
  {
      routePath: "/",
      mountPath: "/",
      method: "",
      middlewares: [___middleware_ts_onRequest],
      modules: [],
    },
  ]