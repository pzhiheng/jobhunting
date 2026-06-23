import { readFileSync } from "node:fs";

export type ResumeContent =
  | { kind: "text"; text: string }
  | { kind: "pdf"; data: string }; // base64

const MD_PATH = new URL("../resume.md", import.meta.url).pathname;
const PDF_PATH = new URL("../resume.pdf", import.meta.url).pathname;

/** Load the candidate's résumé from resume.md (preferred) or resume.pdf. Null if neither. */
export function loadResume(): ResumeContent | null {
  try {
    return { kind: "text", text: readFileSync(MD_PATH, "utf8") };
  } catch {
    /* try pdf */
  }
  try {
    return { kind: "pdf", data: readFileSync(PDF_PATH).toString("base64") };
  } catch {
    return null;
  }
}
