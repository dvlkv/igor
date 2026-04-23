/** Map Claude tool names to human-friendly progress descriptions. */
export function toolDisplayName(toolName: string): string {
  const map: Record<string, string> = {
    Bash: "Running command",
    Read: "Reading files",
    Grep: "Searching codebase",
    Edit: "Editing files",
    Write: "Writing files",
    Glob: "Finding files",
    WebSearch: "Searching the web",
    WebFetch: "Fetching page",
    Agent: "Running subagent",
    AskUserQuestion: "Asking a question",
  };
  return map[toolName] ?? "Working";
}
