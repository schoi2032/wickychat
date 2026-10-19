import { getChatGPTUser } from "@/app/chatgpt-auth";
import { fail, route } from "@/lib/api";
import { handleLocalApi } from "@/lib/local-api";

type Context = { params: Promise<{ path: string[] }> };
const handler = route(async (request: Request, context: Context) => {
  const user = await getChatGPTUser();
  if (!user) return fail(401, "not_signed_in", "Sign in to open WICKY.");
  return handleLocalApi(request, (await context.params).path, user);
});
export {
  handler as GET,
  handler as POST,
  handler as PATCH,
  handler as PUT,
  handler as DELETE,
};
