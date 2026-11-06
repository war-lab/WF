// 入口の Worker と部屋の Durable Object（BD05）。M0 は骨組みだけで、API は M3 で作る。
import { DurableObject } from "cloudflare:workers";

export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace<Room>;
}

export class Room extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response("not implemented", { status: 501 });
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "NOT_IMPLEMENTED" }, { status: 501 });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
