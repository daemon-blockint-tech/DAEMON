import { ChatOpenRouter } from "@langchain/openrouter";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export type TextLlm = {
  complete(system: string, user: string): Promise<string>;
};

export function resolveOpenRouterApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.OPENROUTER_API_KEY ?? env.DAEMON_OPENROUTER_API_KEY;
}

export function createChatOpenRouter(
  env: NodeJS.ProcessEnv = process.env,
): ChatOpenRouter {
  const apiKey = resolveOpenRouterApiKey(env);
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY or DAEMON_OPENROUTER_API_KEY is required");
  }
  return new ChatOpenRouter({
    model:
      env.DAEMON_ONTOLOGY_QUERY_MODEL ?? "anthropic/claude-sonnet-4.5",
    temperature: 0,
    maxTokens: 2048,
    apiKey,
    siteUrl: env.DAEMON_OPENROUTER_SITE_URL,
    siteName: env.DAEMON_OPENROUTER_SITE_NAME ?? "daemon-sdk",
  });
}

export function chatOpenRouterAsLlm(model: ChatOpenRouter): TextLlm {
  return {
    async complete(system, user) {
      const response = await model.invoke([
        new SystemMessage(system),
        new HumanMessage(user),
      ]);
      const content = response.content;
      if (typeof content === "string") return content.trim();
      if (Array.isArray(content)) {
        return content
          .map((part) =>
            typeof part === "string"
              ? part
              : "text" in part
                ? String(part.text)
                : "",
          )
          .join("")
          .trim();
      }
      return String(content ?? "").trim();
    },
  };
}

export function extractCypherBlock(text: string): string {
  const fenced = text.match(/```(?:cypher)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return text.trim();
}
