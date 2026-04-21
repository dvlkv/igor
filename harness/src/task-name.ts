import { execFile } from "node:child_process";

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "task";
  if (slug.length <= 50) return slug;
  const truncated = slug.slice(0, 50).replace(/-+$/, "");
  return truncated || "task";
}

export async function generateTaskName(
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
    console.log(`[task-name] Haiku call failed: ${err}`);
    return title.slice(0, 50);
  }
}
