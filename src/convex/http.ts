import { httpRouter } from "convex/server";
import { auth } from "./auth";
import apiRest, { restRoutes } from "./api";

const http = httpRouter();

auth.addHttpRoutes(http);

// Spec REST surface (/api/*) — see src/convex/api.ts. Handlers are registered
// once there and re-mounted here because Convex routers don't compose.
for (const r of restRoutes) {
  http.route({ path: r.path, method: r.method, handler: r.handler });
}
void apiRest;

export default http;
