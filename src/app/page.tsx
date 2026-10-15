import ChatApp from "@/components/chat-app";
import { appMode } from "@/lib/app-mode";
import { aiEnabled } from "@/lib/ai";

export const dynamic = "force-dynamic";

export default function Home() {
  const mode = appMode();
  return (
    <ChatApp mode={mode} aiAvailable={mode === "supabase" && aiEnabled()} />
  );
}
