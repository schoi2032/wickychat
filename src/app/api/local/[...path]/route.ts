import { route } from "@/lib/api";
import { handleLocalApi } from "@/lib/local-api";

export const runtime = "nodejs";
const handler = route(
  async (request: Request, context: RouteContext<"/api/local/[...path]">) => {
    const { path } = await context.params;
    return handleLocalApi(request, path);
  },
);
export {
  handler as GET,
  handler as POST,
  handler as PATCH,
  handler as PUT,
  handler as DELETE,
};
