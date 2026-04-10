import { execFile } from "node:child_process";

/**
 * Generate a short thread name (≤50 chars) from a task title/description using Haiku.
 * Falls back to truncated title on failure.
 */
export async function generateThreadName(
  title: string,
  description?: string,
): Promise<string> {
  const input = description ? `${title}\n\n${description}` : title;
  const prompt = `Generate a very short thread name (max 50 characters) for this task. Reply with ONLY the thread name, nothing else.\n\nTask: ${input}`;

  try {
    const text = await new Promise<string>((resolve, reject) => {
      execFile(
        "claude",
        ["--model", "haiku", "-p", prompt],
        { timeout: 15000 },
        (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout.trim());
        },
      );
    });
    if (text && text.length <= 50) return text;
    return text.slice(0, 50) || title.slice(0, 50);
  } catch (err) {
    console.log(`[thread-name] Haiku call failed: ${err}`);
    return title.slice(0, 50);
  }
}
