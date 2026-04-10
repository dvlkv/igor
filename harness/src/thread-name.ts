import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

/**
 * Generate a short thread name (≤50 chars) from a task title/description using Haiku.
 * Falls back to truncated title on failure.
 */
export async function generateThreadName(
  title: string,
  description?: string,
): Promise<string> {
  const input = description ? `${title}\n\n${description}` : title;
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 60,
      messages: [
        {
          role: "user",
          content: `Generate a very short thread name (max 50 characters) for this task. Reply with ONLY the thread name, nothing else.\n\nTask: ${input}`,
        },
      ],
    });
    const text =
      response.content[0].type === "text" ? response.content[0].text.trim() : "";
    if (text && text.length <= 50) return text;
    return text.slice(0, 50) || title.slice(0, 50);
  } catch (err) {
    console.log(`[thread-name] Haiku call failed: ${err}`);
    return title.slice(0, 50);
  }
}
